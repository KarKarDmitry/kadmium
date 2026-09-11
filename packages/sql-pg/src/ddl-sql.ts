/**
 * Pure DDL SQL statement builders.
 * Shared by PgDdlAdapter (executes statements) and diff/render.ts (preview).
 * A single source of truth — any format change must land here only.
 *
 * Statements are returned WITHOUT a trailing semicolon.
 */
import type {
  DbColumn,
  DbForeignKey,
  DbIndex,
} from '@karkardmitry/kadmium-sql-types';

/** One column definition inside CREATE TABLE. */
export function columnDefSql(col: DbColumn): string {
  let type = col.dataType;
  if (col.autoIncrement) {
    if (type === 'integer') type = 'serial';
    else if (type === 'bigint') type = 'bigserial';
  }
  const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
  const pk = col.isPrimary ? 'PRIMARY KEY' : '';
  const uniq = col.isUnique && !col.isPrimary ? 'UNIQUE' : '';
  const def = col.autoIncrement
    ? ''
    : col.defaultValue !== null
      ? `DEFAULT ${col.defaultValue}`
      : '';
  return `"${col.name}" ${type} ${nullable} ${pk} ${uniq} ${def}`.trim();
}

export function createTableSql(tableName: string, columns: DbColumn[]): string {
  const colDefs = columns.map(columnDefSql).join(',\n  ');
  return `CREATE TABLE "${tableName}" (\n  ${colDefs}\n)`;
}

export function addColumnSql(table: string, col: DbColumn): string {
  const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
  const def = col.defaultValue !== null ? `DEFAULT ${col.defaultValue}` : '';
  return `ALTER TABLE "${table}" ADD COLUMN "${col.name}" ${col.dataType} ${nullable} ${def}`.trim();
}

export function dropColumnSql(table: string, colName: string): string {
  return `ALTER TABLE "${table}" DROP COLUMN "${colName}" CASCADE`;
}

export function alterTypeSql(
  table: string,
  colName: string,
  newType: string,
): string {
  return `ALTER TABLE "${table}" ALTER COLUMN "${colName}" TYPE ${newType} USING "${colName}"::${newType}`;
}

export function alterNullableSql(
  table: string,
  colName: string,
  nullable: boolean,
): string {
  const action = nullable ? 'DROP NOT NULL' : 'SET NOT NULL';
  return `ALTER TABLE "${table}" ALTER COLUMN "${colName}" ${action}`;
}

export function alterDefaultSql(
  table: string,
  colName: string,
  defaultValue: string | null,
): string {
  if (defaultValue === null) {
    return `ALTER TABLE "${table}" ALTER COLUMN "${colName}" DROP DEFAULT`;
  }
  return `ALTER TABLE "${table}" ALTER COLUMN "${colName}" SET DEFAULT ${defaultValue}`;
}

export function addIndexSql(idx: DbIndex): string {
  const cols = idx.columns.map((c) => `"${c}"`).join(', ');
  const unique = idx.isUnique ? 'UNIQUE ' : '';
  return `CREATE ${unique}INDEX "${idx.name}" ON "${idx.tableName}" (${cols})`;
}

export function dropIndexSql(indexName: string): string {
  return `DROP INDEX IF EXISTS "${indexName}"`;
}

export function addForeignKeySql(fk: DbForeignKey): string {
  const cols = fk.columns.map((c) => `"${c}"`).join(', ');
  const refCols = fk.refColumns.map((c) => `"${c}"`).join(', ');
  return `ALTER TABLE "${fk.tableName}" ADD CONSTRAINT "${fk.name}"
       FOREIGN KEY (${cols}) REFERENCES "${fk.refTable}" (${refCols})
       ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
}

export function dropForeignKeySql(tableName: string, fkName: string): string {
  return `ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${fkName}"`;
}

export function dropTableSql(tableName: string): string {
  return `DROP TABLE IF EXISTS "${tableName}" CASCADE`;
}
