/**
 * Schema diff — движок миграций.
 *
 * Диалект-независим: единственное, чего движок ждёт от базы, это `Dialect`
 * (имя типа, текст `DEFAULT`) и `DbDdlAdapter` (интроспекция и исполнение DDL).
 * PostgreSQL-часть лежит в `sql-pg`: `pgDialect`, `PgDdlAdapter` и SQL-текст
 * (`renderSql`).
 */

export { computeDiff } from './compute';
export { checkHealth, diffToHealth } from './health';
export {
  expectedForeignKeys,
  expectedIndexes,
  irToColumns,
  isAutoIncrementField,
  isPrimaryField,
} from './expected';
export type {
  DiffOp,
  DiffResult,
  HealthCheckResult,
  IrField,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';
