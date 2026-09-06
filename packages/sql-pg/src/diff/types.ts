/**
 * Schema diff — types and IR → PG mapping helpers.
 */

import type {
  DbColumn,
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

export type IrField = {
  type: string;
  ref?: string;
  sourceModel?: string;
  nullable: boolean;
  unique: boolean;
  index?: boolean;
  isPrimary?: boolean;
  alias?: string;
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

export function isPrimaryField(f: IrField): boolean {
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

export function irToColumns(
  tableName: string,
  irFields: Record<string, IrField>,
  irs: Array<{ name: string; fields: Record<string, IrField> }>,
): DbColumn[] {
  return Object.entries(irFields)
    .filter(([, f]) => !f.sourceModel)
    .map(([name, f]) => ({
      name: f.alias ?? name,
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

export function expectedIndexes(
  tableName: string,
  irFields: Record<string, IrField>,
): DbIndex[] {
  const indexes: DbIndex[] = [];
  for (const [name, f] of Object.entries(irFields)) {
    if (f.sourceModel || isPrimaryField(f)) continue;
    // Ref fields automatically get an index
    if (f.unique || f.index || f.type === 'ref') {
      indexes.push({
        name: `idx_${tableName}_${f.alias ?? name}`,
        tableName,
        columns: [f.alias ?? name],
        isUnique: !!f.unique,
      });
    }
  }
  return indexes;
}

export function expectedForeignKeys(
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
      name: `fk_${tableName}_${f.alias ?? name}`,
      tableName,
      columns: [f.alias ?? name],
      refTable: f.ref.toLowerCase(),
      refColumns: [pkName],
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  }
  return fks;
}
