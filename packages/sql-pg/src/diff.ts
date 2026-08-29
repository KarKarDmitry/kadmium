/**
 * Schema diff — compare IR models with actual DB state.
 *
 * Ported from kadmium-core's db-mutator, adapted for our IR types.
 * Key differences vs old codebase:
 * - Uses flat IR model definitions instead of SchemaCore/NormalizedInputField
 * - All IR fields are `{ type, ref, nullable, unique, index, spec, sourceModel }`
 * - Primary key is identified by type === 'primary'
 */

import type {
  DbColumn,
  DbDdlAdapter,
  DbIndex,
  DbForeignKey,
} from '@karkardmitry/kadmium-sql-types';

/* ── Diff Operation Types ── */

export interface AddColumnOp {
  type: 'add-column';
  table: string;
  column: DbColumn;
}

export interface DropColumnOp {
  type: 'drop-column';
  table: string;
  columnName: string;
}

export interface AlterTypeOp {
  type: 'alter-type';
  table: string;
  columnName: string;
  oldType: string;
  newType: string;
}

export interface AlterNullableOp {
  type: 'alter-nullable';
  table: string;
  columnName: string;
  oldNullable: boolean;
  newNullable: boolean;
}

export interface AddIndexOp {
  type: 'add-index';
  index: DbIndex;
}

export interface DropIndexOp {
  type: 'drop-index';
  indexName: string;
  tableName: string;
}

export interface AddForeignKeyOp {
  type: 'add-foreign-key';
  fk: DbForeignKey;
}

export interface DropForeignKeyOp {
  type: 'drop-foreign-key';
  fkName: string;
  tableName: string;
}

export interface CreateTableOp {
  type: 'create-table';
  table: string;
  columns: DbColumn[];
}

export interface DropTableOp {
  type: 'drop-table';
  table: string;
}

export type DiffOp =
  | AddColumnOp
  | DropColumnOp
  | AlterTypeOp
  | AlterNullableOp
  | AddIndexOp
  | DropIndexOp
  | AddForeignKeyOp
  | DropForeignKeyOp
  | CreateTableOp
  | DropTableOp;

export interface DiffResult {
  operations: DiffOp[];
  hasChanges: boolean;
  summary: {
    addedTables: number;
    droppedTables: number;
    addedColumns: number;
    droppedColumns: number;
    alteredColumns: number;
    addedIndexes: number;
    droppedIndexes: number;
    addedForeignKeys: number;
    droppedForeignKeys: number;
  };
}

export interface HealthCheckResult {
  isHealthy: boolean;
  issues: string[];
  summary: {
    tablesMissing: number;
    tablesExpected: number;
    tablesMatching: number;
  };
}

/* ── IR field type → PG data type ── */

type IrField = {
  type: string;
  ref?: string;
  sourceModel?: string;
  nullable: boolean;
  unique: boolean;
  index?: boolean;
  isPrimary?: boolean;
  spec?: Record<string, unknown>;
};

export function pgType(
  name: string,
  f: IrField,
  irs: Array<{
    name: string;
    fields: Record<string, IrField>;
  }>,
): string {
  const dbType = f.spec?.db_type as string | undefined;
  if (f.type === 'primary') {
    if (dbType === 'uuid') return 'uuid';
    if (dbType === 'string') return 'character varying';
    if (dbType === 'numeric') return 'numeric';
    return 'integer';
  }
  if (f.type === 'ref' && f.ref) {
    const target = irs.find(
      (m) => m.name.toLowerCase() === f.ref!.toLowerCase(),
    );
    if (target) {
      const pkField = Object.values(target.fields).find((pf) =>
        isPrimaryField(pf),
      );
      if (pkField) return pgType(name, pkField, irs);
    }
  }
  if (f.type === 'string') return 'character varying';
  if (f.type === 'number') return 'integer';
  if (f.type === 'int') return 'integer';
  if (f.type === 'bigint') return 'bigint';
  if (f.type === 'decimal' || f.type === 'numeric') return 'numeric';
  if (f.type === 'float') return 'double precision';
  if (f.type === 'boolean') return 'boolean';
  if (f.type === 'date') return 'date';
  if (f.type === 'datetime' || f.type === 'time')
    return 'timestamp without time zone';
  if (f.type === 'uuid') return 'uuid';
  return 'text';
}

/** Normalize PG type for comparison */
export function normalizePgType(type: string): string {
  const t = type.toLowerCase().trim();
  if (t === 'character varying') return 'varchar';
  if (t === 'timestamp without time zone') return 'timestamp';
  if (t === 'time without time zone') return 'time';
  if (t === 'double precision') return 'float8';
  if (t === 'integer' || t === 'int' || t === 'int4') return 'integer';
  if (t.startsWith('varchar')) return 'varchar';
  if (t === 'numeric' || t === 'decimal') return 'numeric';
  if (t === 'bigint') return 'bigint';
  return t;
}

/* ── IR → columns helper ── */

function isPrimaryField(f: IrField): boolean {
  return f.isPrimary === true || f.type === 'primary';
}

/** Рендерит default-значение как корректный SQL-литерал по типу поля. */
export function renderDefault(f: IrField): string | null {
  const value = f.spec?.default;
  if (value === undefined || value === null) return null;
  switch (f.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'true' : 'false';
    case 'number':
    case 'int':
    case 'bigint':
    case 'decimal':
    case 'float':
    case 'numeric':
      return String(value);
    case 'datetime':
    case 'date':
    case 'time':
      return `'${value instanceof Date ? value.toISOString() : String(value)}'`;
    case 'string':
    case 'uuid':
    default:
      return `'${String(value).replace(/'/g, "''")}'`;
  }
}

function irToColumns(
  tableName: string,
  irFields: Record<string, IrField>,
  irs: Array<{ name: string; fields: Record<string, IrField> }>,
): DbColumn[] {
  return Object.entries(irFields)
    .filter(([, f]) => !f.sourceModel)
    .map(([name, f]) => ({
      name,
      tableName,
      dataType: pgType(name, f, irs),
      isNullable: f.nullable && !isPrimaryField(f),
      defaultValue: renderDefault(f),
      isPrimary: isPrimaryField(f),
      isUnique: f.unique || isPrimaryField(f),
      autoIncrement:
        isPrimaryField(f) &&
        f.spec?.db_type !== 'uuid' &&
        f.spec?.db_type !== 'string',
    }));
}

function expectedIndexes(
  tableName: string,
  irFields: Record<string, IrField>,
): DbIndex[] {
  const indexes: DbIndex[] = [];
  for (const [name, f] of Object.entries(irFields)) {
    if (f.sourceModel || isPrimaryField(f)) continue;
    // Ref fields automatically get an index
    if (f.unique || f.index || f.type === 'ref') {
      indexes.push({
        name: `idx_${tableName}_${name}`,
        tableName,
        columns: [name],
        isUnique: !!f.unique,
      });
    }
  }
  return indexes;
}

function expectedForeignKeys(
  tableName: string,
  irFields: Record<string, IrField>,
  irs: Array<{ name: string; fields: Record<string, IrField> }>,
): DbForeignKey[] {
  const fks: DbForeignKey[] = [];
  for (const [name, f] of Object.entries(irFields)) {
    if (f.sourceModel || !f.ref) continue;
    const target = irs.find((m) => m.name === f.ref);
    if (!target) continue;
    const pkEntry = Object.entries(target.fields).find(([, pf]) =>
      isPrimaryField(pf),
    );
    if (!pkEntry) continue;
    const [pkName] = pkEntry;

    fks.push({
      name: `fk_${tableName}_${name}`,
      tableName,
      columns: [name],
      refTable: f.ref.toLowerCase(),
      refColumns: [pkName],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  }
  return fks;
}

/* ════════════════════════════════════════
   Health Check
   ════════════════════════════════════════ */

export async function checkHealth(
  irs: Array<{
    name: string;
    collection: string;
    fields: Record<string, IrField>;
  }>,
  ddl: DbDdlAdapter,
): Promise<HealthCheckResult> {
  const diff = await computeDiff(irs, ddl);
  return diffToHealth(irs, diff);
}

export function diffToHealth(
  irs: Array<{ name: string; collection: string }>,
  diff: DiffResult,
): HealthCheckResult {
  const issues: string[] = [];

  if (diff.summary.addedTables > 0) {
    issues.push(`${diff.summary.addedTables} table(s) missing from database`);
  }
  if (diff.summary.addedColumns > 0) {
    issues.push(`${diff.summary.addedColumns} column(s) missing`);
  }
  if (diff.summary.droppedColumns > 0) {
    issues.push(`${diff.summary.droppedColumns} extra column(s) in database`);
  }
  if (diff.summary.alteredColumns > 0) {
    issues.push(
      `${diff.summary.alteredColumns} column(s) have type/nullability changes`,
    );
  }
  if (diff.summary.addedIndexes > 0) {
    issues.push(`${diff.summary.addedIndexes} index(es) missing`);
  }
  if (diff.summary.addedForeignKeys > 0) {
    issues.push(`${diff.summary.addedForeignKeys} foreign key(s) missing`);
  }

  return {
    isHealthy: issues.length === 0,
    issues,
    summary: {
      tablesMissing: diff.summary.addedTables,
      tablesExpected: irs.length,
      tablesMatching: irs.length - diff.summary.addedTables,
    },
  };
}

/* ════════════════════════════════════════
   computeDiff — compare IR models with DB
   ════════════════════════════════════════ */

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
      const dbCol = dbColMap.get(name);

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
            columnName: name,
            oldType: dbCol.dataType,
            newType: expectedType,
          });
          summary.alteredColumns++;
        }

        // Check nullable
        const expectedNullable = f.nullable && f.type !== 'primary';
        if (dbCol.isNullable !== expectedNullable) {
          operations.push({
            type: 'alter-nullable',
            table: tableName,
            columnName: name,
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
        .map(([n]) => n),
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

/* ════════════════════════════════════════
   applyDiff — apply structured ops to DB
   ════════════════════════════════════════ */

/** Render a single DiffOp as a human-readable description */
function opToString(op: DiffOp): string {
  switch (op.type) {
    case 'create-table':
      return `CREATE TABLE ${op.table}`;
    case 'drop-table':
      return `DROP TABLE ${op.table}`;
    case 'add-column':
      return `ADD COLUMN ${op.table}.${op.column.name}`;
    case 'drop-column':
      return `DROP COLUMN ${op.table}.${op.columnName}`;
    case 'alter-type':
      return `ALTER TYPE ${op.table}.${op.columnName}: ${op.oldType} → ${op.newType}`;
    case 'alter-nullable':
      return `ALTER NULLABLE ${op.table}.${op.columnName}: ${op.oldNullable} → ${op.newNullable}`;
    case 'add-index':
      return `ADD INDEX ${op.index.name} on ${op.index.tableName}`;
    case 'drop-index':
      return `DROP INDEX ${op.indexName}`;
    case 'add-foreign-key':
      return `ADD FK ${op.fk.name} (${op.fk.tableName} → ${op.fk.refTable})`;
    case 'drop-foreign-key':
      return `DROP FK ${op.fkName} on ${op.tableName}`;
  }
}

export async function applyDiff(
  diff: DiffResult,
  ddl: DbDdlAdapter,
): Promise<string[]> {
  const applied: string[] = [];

  // Phase 1: CREATE TABLE (without inline UNIQUE for index fields)
  // Indexes and FKs are handled in phase 2
  const tableOps = diff.operations.filter((o) => o.type === 'create-table');
  for (const op of tableOps) {
    // Strip inline UNIQUE from columns that will get separate index ops
    // (otherwise PG auto-creates indexes with _key suffix that we can't track)
    const idxFieldNames = new Set(
      diff.operations
        .filter(
          (o): o is AddIndexOp =>
            o.type === 'add-index' && o.index.tableName === op.table,
        )
        .flatMap((o) => o.index.columns),
    );
    const cols = op.columns.map((c) => ({
      ...c,
      isUnique: c.isUnique && !idxFieldNames.has(c.name) ? false : c.isUnique,
    }));
    await ddl.createTable(op.table, cols);
    applied.push(opToString(op));
  }

  // Phase 2: Everything else (indexes, FKs, alters)
  const restOps = diff.operations.filter((o) => o.type !== 'create-table');
  for (const op of restOps) {
    await executeOp(op, ddl);
    applied.push(opToString(op));
  }

  return applied;
}

async function executeOp(op: DiffOp, ddl: DbDdlAdapter): Promise<void> {
  switch (op.type) {
    case 'create-table':
      // handled above
      break;
    case 'drop-table':
      console.warn(`[kadmium] Skipping drop-table: ${op.table}`);
      break;
    case 'add-column':
      await ddl.addColumn(op.table, op.column);
      break;
    case 'drop-column':
      await ddl.dropColumn(op.table, op.columnName);
      break;
    case 'alter-type':
      await ddl.alterType(op.table, op.columnName, op.newType);
      break;
    case 'alter-nullable':
      await ddl.alterNullable(op.table, op.columnName, op.newNullable);
      break;
    case 'add-index':
      await ddl.addIndex(op.index);
      break;
    case 'drop-index':
      await ddl.dropIndex(op.indexName, op.tableName);
      break;
    case 'add-foreign-key':
      await ddl.addForeignKey(op.fk);
      break;
    case 'drop-foreign-key':
      await ddl.dropForeignKey(op.fkName, op.tableName);
      break;
  }
}

/* ════════════════════════════════════════
   renderSql — generate SQL preview string
   ════════════════════════════════════════ */

function opToSql(op: DiffOp): string {
  switch (op.type) {
    case 'create-table': {
      const colDefs = op.columns
        .map((c) => {
          let type = c.dataType;
          if (c.autoIncrement) {
            if (type === 'integer') type = 'serial';
            else if (type === 'bigint') type = 'bigserial';
          }
          const nullable = c.isNullable ? 'NULL' : 'NOT NULL';
          const pk = c.isPrimary ? 'PRIMARY KEY' : '';
          const uniq = c.isUnique && !c.isPrimary ? 'UNIQUE' : '';
          return `  "${c.name}" ${type} ${nullable} ${pk} ${uniq}`.trim();
        })
        .join(',\n');
      return `CREATE TABLE "${op.table}" (\n${colDefs}\n);`;
    }
    case 'drop-table':
      return `DROP TABLE "${op.table}" CASCADE;`;
    case 'add-column': {
      const c = op.column;
      const nullable = c.isNullable ? 'NULL' : 'NOT NULL';
      return `ALTER TABLE "${op.table}" ADD COLUMN "${c.name}" ${c.dataType} ${nullable};`;
    }
    case 'drop-column':
      return `ALTER TABLE "${op.table}" DROP COLUMN "${op.columnName}" CASCADE;`;
    case 'alter-type':
      return `ALTER TABLE "${op.table}" ALTER COLUMN "${op.columnName}" TYPE ${op.newType} USING "${op.columnName}"::${op.newType};`;
    case 'alter-nullable':
      return op.newNullable
        ? `ALTER TABLE "${op.table}" ALTER COLUMN "${op.columnName}" DROP NOT NULL;`
        : `ALTER TABLE "${op.table}" ALTER COLUMN "${op.columnName}" SET NOT NULL;`;
    case 'add-index': {
      const cols = op.index.columns.map((c) => `"${c}"`).join(', ');
      const unique = op.index.isUnique ? 'UNIQUE ' : '';
      return `CREATE ${unique}INDEX "${op.index.name}" ON "${op.index.tableName}" (${cols});`;
    }
    case 'drop-index':
      return `DROP INDEX IF EXISTS "${op.indexName}";`;
    case 'add-foreign-key': {
      const cols = op.fk.columns.map((c) => `"${c}"`).join(', ');
      const refCols = op.fk.refColumns.map((c) => `"${c}"`).join(', ');
      return `ALTER TABLE "${op.fk.tableName}" ADD CONSTRAINT "${op.fk.name}" FOREIGN KEY (${cols}) REFERENCES "${op.fk.refTable}" (${refCols}) ON DELETE ${op.fk.onDelete} ON UPDATE ${op.fk.onUpdate};`;
    }
    case 'drop-foreign-key':
      return `ALTER TABLE "${op.tableName}" DROP CONSTRAINT IF EXISTS "${op.fkName}";`;
  }
}

export function renderSql(diff: DiffResult): string {
  if (!diff.hasChanges) return '-- No changes needed.\n';
  const lines = diff.operations.map((op) => opToSql(op));
  return `BEGIN;\n\n${lines.join('\n\n')}\n\nCOMMIT;\n`;
}
