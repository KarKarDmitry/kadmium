/**
 * Schema diff — PostgreSQL-часть.
 *
 * Здесь осталось то, что по природе PostgreSQL: имена типов и текст `DEFAULT`
 * (`types.ts`), SQL-текст DDL (`ddl-sql.ts`, `render.ts`) и его валидация.
 * Принятие решений — `computeDiff()`, `checkHealth()`, `applyDiff()`,
 * `expectedIndexes()` и прочие — живёт в `core/src/diff/`, потому что одинаково
 * для любой базы.
 */

export { pgType, normalizePgType, renderDefault } from './types';
export { renderSql } from './render';
