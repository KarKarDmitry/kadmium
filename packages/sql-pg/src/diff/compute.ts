/**
 * computeDiff — compare IR models with actual DB state.
 */

import type { DbDdlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { DiffOp, DiffResult, IrField } from './types';
import {
  pgType,
  normalizePgType,
  isPrimaryField,
  irToColumns,
  expectedIndexes,
  expectedForeignKeys,
} from './types';

export async function computeDiff(
  irs: Array<{
    name: string;
    collection: string;
    fields: Record<string, IrField>;
  }>,
  ddl: DbDdlAdapter,
): Promise<DiffResult> {
  const operations: DiffOp[] = [];
  const summary: DiffResult['summary'] = {
    addedTables: 0,
    droppedTables: 0,
    addedColumns: 0,
    droppedColumns: 0,
    alteredColumns: 0,
    addedIndexes: 0,
    droppedIndexes: 0,
    addedForeignKeys: 0,
    droppedForeignKeys: 0,
  };

  const dbTables = new Map<string, boolean>();
  for (const table of await ddl.inspectTables()) {
    dbTables.set(table.name, true);
  }

  // ── Table-level diff: new tables ──
  const expectedTableNames = new Set(irs.map((ir) => ir.collection));
  for (const ir of irs) {
    const tableName = ir.collection;
    if (!dbTables.has(tableName)) {
      const columns = irToColumns(tableName, ir.fields, irs);
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

    const dbCols = await ddl.inspectColumns(tableName);
    const dbColMap = new Map(dbCols.map((c) => [c.name, c]));
    const dbIndexes = await ddl.inspectIndexes(tableName);
    const dbFks = await ddl.inspectForeignKeys(tableName);

    // Column diff
    for (const [name, f] of Object.entries(ir.fields)) {
      if (f.sourceModel) continue;
      const colName = f.alias ?? name;
      const dbCol = dbColMap.get(colName);

      if (!dbCol) {
        // New column
        const col = irToColumns(tableName, { [name]: f }, irs)[0];
        operations.push({ type: 'add-column', table: tableName, column: col });
        summary.addedColumns++;
      } else {
        // Check type
        const expectedType = pgType(name, f, irs);
        const normalizedExpected = normalizePgType(expectedType);
        const normalizedActual = normalizePgType(dbCol.dataType);

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
    const dbIdxNames = new Set(dbIndexes.map((i) => i.name));

    // Skip PG auto-generated indexes (UNIQUE constraint creates `table_col_key`)
    const nonSystemDbIdx = dbIndexes.filter(
      (i) => !i.name.endsWith('_pkey') && !i.name.endsWith('_key'),
    );

    for (const idx of expectedIdxs) {
      if (!dbIdxNames.has(idx.name)) {
        operations.push({ type: 'add-index', index: idx });
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
    const dbFkNames = new Set(dbFks.map((f) => f.name));

    for (const fk of expectedFks) {
      if (!dbFkNames.has(fk.name)) {
        operations.push({ type: 'add-foreign-key', fk });
        summary.addedForeignKeys++;
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
