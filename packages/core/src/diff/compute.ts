/**
 * computeDiff — сравнить IR с фактическим состоянием базы.
 *
 * Диалект приходит параметром: движок сам ничего не знает про PostgreSQL, а
 * `renderDefault`/`normalizeTypeName` — это всё, чем базы различаются в части
 * сравнения колонок.
 */

import type {
  DbDdlAdapter,
  DbForeignKey,
  Dialect,
  DiffOp,
  DiffResult,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';
import {
  expectedForeignKeys,
  expectedIndexes,
  irToColumns,
  isAutoIncrementField,
  isPrimaryField,
} from './expected';

export async function computeDiff(
  irs: readonly IrModel[],
  ddl: DbDdlAdapter,
  dialect: Dialect,
): Promise<DiffResult> {
  const operations: DiffOp[] = [];
  const summary: DiffResult['summary'] = {
    addedTables: 0,
    droppedTables: 0,
    addedColumns: 0,
    droppedColumns: 0,
    alteredColumns: 0,
    alteredDefaults: 0,
    addedIndexes: 0,
    droppedIndexes: 0,
    addedForeignKeys: 0,
    droppedForeignKeys: 0,
    alteredForeignKeys: 0,
  };

  const dbTables = new Map<string, boolean>();
  for (const table of await ddl.inspectTables()) {
    dbTables.set(table.name, true);
  }

  // Batched introspection: 3 round trips total, regardless of table count.
  const existingModelTables = irs
    .map((ir) => ir.collection)
    .filter((name) => dbTables.has(name));

  const [allColumns, allIndexes, allForeignKeys] =
    existingModelTables.length > 0
      ? await Promise.all([
          ddl.inspectAllColumns(existingModelTables),
          ddl.inspectAllIndexes(existingModelTables),
          ddl.inspectAllForeignKeys(existingModelTables),
        ])
      : [[], [], []];

  const columnsByTable = groupByTable(allColumns);
  const indexesByTable = groupByTable(allIndexes);
  const foreignKeysByTable = groupByTable(allForeignKeys);

  // ── Table-level diff: new tables ──
  const expectedTableNames = new Set(irs.map((ir) => ir.collection));
  for (const ir of irs) {
    const tableName = ir.collection;
    if (!dbTables.has(tableName)) {
      const columns = irToColumns(tableName, ir.fields, irs, dialect);
      operations.push({ type: 'create-table', table: tableName, columns });
      summary.addedTables++;

      // Indexes for new table (handled in Phase 2 of applyDiff)
      const idxs = expectedIndexes(tableName, ir.fields);
      for (const idx of idxs) {
        operations.push({ type: 'add-index', index: idx });
        summary.addedIndexes++;
      }

      // Foreign keys for new table
      const fks = expectedForeignKeys(tableName, ir.fields, irs);
      for (const fk of fks) {
        operations.push({ type: 'add-foreign-key', fk });
        summary.addedForeignKeys++;
      }
    }
  }

  // Tables in DB but not in schema — noted but not auto-dropped
  for (const tableName of dbTables.keys()) {
    if (!expectedTableNames.has(tableName)) {
      // Don't auto-drop
    }
  }

  // ── Column, Index, FK diff for existing tables ──
  for (const ir of irs) {
    const tableName = ir.collection;
    if (!dbTables.has(tableName)) continue; // new table handled above

    const dbCols = columnsByTable.get(tableName) ?? [];
    const dbColMap = new Map(dbCols.map((c) => [c.name, c]));
    const dbIndexes = indexesByTable.get(tableName) ?? [];
    const dbFks = foreignKeysByTable.get(tableName) ?? [];

    // Column diff
    for (const [name, f] of Object.entries(ir.fields)) {
      if (f.sourceModel) continue;
      const colName = f.alias ?? name;
      const dbCol = dbColMap.get(colName);

      if (!dbCol) {
        // New column
        const col = irToColumns(tableName, { [name]: f }, irs, dialect)[0];
        operations.push({ type: 'add-column', table: tableName, column: col });
        summary.addedColumns++;
      } else {
        // Check type
        const expectedType = dialect.typeName(f, irs);
        const normalizedExpected = dialect.normalizeTypeName(expectedType);
        const normalizedActual = dialect.normalizeTypeName(dbCol.dataType);

        if (normalizedActual !== normalizedExpected) {
          operations.push({
            type: 'alter-type',
            table: tableName,
            columnName: colName,
            oldType: dbCol.dataType,
            newType: expectedType,
          });
          summary.alteredColumns++;
        }

        // Check nullable
        const expectedNullable = f.nullable && !isPrimaryField(f);
        if (dbCol.isNullable !== expectedNullable) {
          operations.push({
            type: 'alter-nullable',
            table: tableName,
            columnName: colName,
            oldNullable: dbCol.isNullable,
            newNullable: expectedNullable,
          });
          summary.alteredColumns++;
        }

        // Check DEFAULT. Колонки с последовательностью исключены с обеих
        // сторон: их дефолт принадлежит базе (`nextval(...)`), а не модели, и
        // сравнение с `renderDefault() === null` снесло бы его — то есть
        // сломало бы вставку в колонку, которая работает. Присваиваем
        // conservative: лучше не заметить чужой дефолт, чем его снести.
        if (!isAutoIncrementField(f) && !dbCol.autoIncrement) {
          const expectedDefault = dialect.renderDefault(f);
          if (!dialect.defaultsEqual(f, expectedDefault, dbCol.defaultValue)) {
            operations.push({
              type: 'alter-default',
              table: tableName,
              columnName: colName,
              oldDefault: dbCol.defaultValue,
              newDefault: expectedDefault,
            });
            summary.alteredDefaults++;
          }
        }
      }
    }

    // Dropped columns (in DB but not in schema)
    const irFieldNames = new Set(
      Object.entries(ir.fields)
        .filter(([, f]) => !f.sourceModel)
        .map(([n, f]) => f.alias ?? n),
    );
    for (const dbCol of dbCols) {
      if (!irFieldNames.has(dbCol.name)) {
        operations.push({
          type: 'drop-column',
          table: tableName,
          columnName: dbCol.name,
        });
        summary.droppedColumns++;
      }
    }

    // Index diff
    const expectedIdxs = expectedIndexes(tableName, ir.fields);
    const expectedIdxNames = new Set(expectedIdxs.map((i) => i.name));
    // По имени, а не только по факту существования: уникальность — часть
    // ожидаемого состояния индекса, и по одному имени расхождение не видно.
    // Сверка по имени молча пропускала оба перехода — поставить и снять
    // `.unique()` на существующем индексе, — оставляя схему в том виде, в
    // каком она была до правки модели.
    const dbIdxsByName = new Map(dbIndexes.map((i) => [i.name, i]));

    // Skip PG auto-generated indexes (UNIQUE constraint creates `table_col_key`)
    const nonSystemDbIdx = dbIndexes.filter(
      (i) => !i.name.endsWith('_pkey') && !i.name.endsWith('_key'),
    );

    for (const idx of expectedIdxs) {
      const existing = dbIdxsByName.get(idx.name);
      if (!existing) {
        operations.push({ type: 'add-index', index: idx });
        summary.addedIndexes++;
      } else if (existing.isUnique !== idx.isUnique) {
        // Отдельной операции «сменить уникальность» нет, а имена совпадают,
        // поэтому пересоздаём индекс существующими же op-ами. Порядок важен:
        // applyDiff выполняет операции в порядке массива, drop должен идти
        // раньше add, иначе add упрётся в уже существующий индекс.
        operations.push({ type: 'drop-index', indexName: idx.name, tableName });
        operations.push({ type: 'add-index', index: idx });
        summary.droppedIndexes++;
        summary.addedIndexes++;
      }
    }

    for (const idx of nonSystemDbIdx) {
      if (!expectedIdxNames.has(idx.name)) {
        operations.push({
          type: 'drop-index',
          indexName: idx.name,
          tableName,
        });
        summary.droppedIndexes++;
      }
    }

    // FK diff
    const expectedFks = expectedForeignKeys(tableName, ir.fields, irs);
    const expectedFkNames = new Set(expectedFks.map((f) => f.name));

    for (const fk of expectedFks) {
      const existing = dbFks.find((f) => f.name === fk.name);
      if (!existing) {
        operations.push({ type: 'add-foreign-key', fk });
        summary.addedForeignKeys++;
      } else if (foreignKeyChanged(existing, fk)) {
        // Имя FK зависит только от таблицы и колонки, поэтому смена действия
        // (или цели ссылки) его не затрагивает и соседних FK не шевелит.
        operations.push({
          type: 'alter-foreign-key',
          fkName: fk.name,
          tableName,
          oldFk: existing,
          newFk: fk,
        });
        summary.alteredForeignKeys++;
      }
    }

    for (const fk of dbFks) {
      if (!expectedFkNames.has(fk.name)) {
        operations.push({
          type: 'drop-foreign-key',
          fkName: fk.name,
          tableName,
        });
        summary.droppedForeignKeys++;
      }
    }
  }

  const result: DiffResult = {
    operations,
    hasChanges: operations.length > 0,
    summary,
  };
  return result;
}

function groupByTable<T extends { tableName: string }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.tableName);
    if (list) list.push(row);
    else map.set(row.tableName, [row]);
  }
  return map;
}

/**
 * Расходится ли существующий FK с ожидаемым по чему-то, кроме имени.
 *
 * Сравниваются колонки, цель и оба действия. Порядок в массивах колонок важен:
 * Postgres хранит его в `information_schema`, но `pg_constraint` может вернуть
 * свой — при перестановке это действительно другой FK, даже если смысл тот же.
 */
function foreignKeyChanged(
  existing: DbForeignKey,
  expected: DbForeignKey,
): boolean {
  return (
    existing.columns.length !== expected.columns.length ||
    existing.columns[0] !== expected.columns[0] ||
    existing.refTable !== expected.refTable ||
    existing.refColumns.length !== expected.refColumns.length ||
    existing.refColumns[0] !== expected.refColumns[0] ||
    existing.onDelete !== expected.onDelete ||
    existing.onUpdate !== expected.onUpdate
  );
}
