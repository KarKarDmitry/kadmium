/**
 * Разбиение multi-row INSERT на батчи под лимит параметров PostgreSQL.
 */

/** Максимум bound-параметров на один стейтмент в PostgreSQL. */
const PG_MAX_PARAMS = 65535;

/**
 * Безопасный размер батча для таблицы с заданным числом колонок:
 * каждый ряд в multi-VALUES вносит `columnCount` параметров.
 */
export function maxBatchRows(columnCount: number): number {
  if (!Number.isInteger(columnCount) || columnCount < 1) return 1;
  return Math.max(1, Math.floor(PG_MAX_PARAMS / columnCount));
}
