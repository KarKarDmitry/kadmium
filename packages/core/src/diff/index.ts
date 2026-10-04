/**
 * Schema diff — движок миграций.
 *
 * Диалект-независим: единственное, чего движок ждёт от базы, это `Dialect`
 * (имя типа, текст `DEFAULT`, текст DDL-превью) и `DbDdlAdapter`
 * (интроспекция и исполнение DDL). PostgreSQL-часть лежит в `sql-pg`:
 * `pgDialect`, `PgDdlAdapter` и SQL-текст (`ddl-sql.ts`).
 */

export { computeDiff } from './compute';
export { applyDiff, applyDiffTransactional } from './apply';
export { checkHealth, diffToHealth } from './health';
export {
  expectedForeignKeys,
  expectedIndexes,
  irToColumns,
  isAutoIncrementField,
  isPrimaryField,
} from './expected';
export type {
  Dialect,
  DiffOp,
  DiffResult,
  HealthCheckResult,
  IrField,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';
