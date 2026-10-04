/**
 * renderSql — generate SQL preview string from DiffResult.
 *
 * Statements are delegated to the shared pure builders in ddl-sql.ts so the
 * preview is always consistent with what PgDdlAdapter executes.
 *
 * The ops arrive already canonical: `computeDiff()` builds `create-table`
 * columns without the inline `UNIQUE` that a separate `add-index` would
 * duplicate. So preview and apply read the same column list by construction —
 * there is no second filtering pass here that could drift from the other side.
 */

import type { DiffOp, DiffResult } from '@karkardmitry/kadmium-sql-types';
import { assertDiffOpSqlSafe } from '../ddl-validate';
import {
  addColumnSql,
  addForeignKeySql,
  addIndexSql,
  alterDefaultSql,
  alterNullableSql,
  alterTypeSql,
  createTableSql,
  dropColumnSql,
  dropForeignKeySql,
  dropIndexSql,
  dropTableSql,
} from '../ddl-sql';

function opToSql(op: DiffOp): string {
  assertDiffOpSqlSafe(op);
  switch (op.type) {
    case 'create-table':
      return `${createTableSql(op.table, op.columns)};`;
    case 'drop-table':
      return `${dropTableSql(op.table)};`;
    case 'add-column':
      return `${addColumnSql(op.table, op.column)};`;
    case 'drop-column':
      return `${dropColumnSql(op.table, op.columnName)};`;
    case 'alter-type':
      return `${alterTypeSql(op.table, op.columnName, op.newType)};`;
    case 'alter-nullable':
      return `${alterNullableSql(op.table, op.columnName, op.newNullable)};`;
    case 'alter-default':
      return `${alterDefaultSql(op.table, op.columnName, op.newDefault)};`;
    case 'add-index':
      return `${addIndexSql(op.index)};`;
    case 'drop-index':
      return `${dropIndexSql(op.indexName)};`;
    case 'add-foreign-key':
      return `${addForeignKeySql(op.fk)};`;
    case 'drop-foreign-key':
      return `${dropForeignKeySql(op.tableName, op.fkName)};`;
    case 'alter-foreign-key':
      // Postgres пересоздаёт ограничение целиком, поэтому превью — две
      // статменты. Порядок тот же, что в executeOp: сначала снять, иначе имя
      // уже занято. renderSql склеивает операции через '\n\n'.
      return `${dropForeignKeySql(op.tableName, op.fkName)};\n${addForeignKeySql(op.newFk)};`;
  }
}

export function renderSql(diff: DiffResult): string {
  if (!diff.hasChanges) return '-- No changes needed.\n';
  const lines = diff.operations.map((op) => opToSql(op));
  return `BEGIN;\n\n${lines.join('\n\n')}\n\nCOMMIT;\n`;
}
