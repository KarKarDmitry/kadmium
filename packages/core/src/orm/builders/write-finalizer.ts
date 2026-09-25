import type { AnySelectable, FlatFinalResult } from '../types/includes';
import type { KadmiumSqb, AnySelectableField } from '../sqb';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type {
  FilterProxy,
  SelectProxy,
  UpdateFinalizer,
  ReturningTools,
} from '../types/proxy';
import { aggregates } from '../field-builders/aggregates';
import { buildDebugSql } from './utils';
import { toSqlCondition } from '../sql-fragment';

type Model = { ['~shape']: Record<string, unknown> };

/**
 * Собрать UPDATE/DELETE финализатор поверх уже сконфигурированного sqb
 * (клон с выставленным operation). Один путь для go/sql/where/returning,
 * общий для update() и delete().
 */
export function buildWriteFinalizer<TModel extends Model>(
  sqb: KadmiumSqb,
  adapter: SqlAdapter | null,
  createFilterProxy: () => FilterProxy<TModel>,
  createSelectProxy: () => SelectProxy<TModel>,
  mapRow: (row: Record<string, unknown>) => Record<string, unknown>,
): UpdateFinalizer<TModel> {
  const requireAdapter = (): SqlAdapter => {
    if (!adapter)
      throw new Error(
        'No adapter configured; call .go() only with an adapter.',
      );
    return adapter;
  };

  const go = async (): Promise<TModel['~shape'][]> => {
    const rows = await requireAdapter().execute(sqb);
    return rows.map(mapRow) as TModel['~shape'][];
  };

  const sql = (): string => {
    if (!adapter)
      throw new Error(
        'No adapter configured. Import createDebugAdapter() from @karkardmitry/kadmium-sql-pg for SQL preview, or pass a PgAdapter for database access.',
      );
    return buildDebugSql(sqb, adapter);
  };

  const mapReturningRow = (
    row: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (!sqb.selects) return mapRow(row);
    const out: Record<string, unknown> = {};
    for (const sel of sqb.selects) {
      const key = sel.alias ?? sel.fieldName;
      if (row[key] !== undefined) out[key] = row[key];
    }
    return out;
  };

  const returning = <S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ) => {
    sqb.selects = [
      ...fn(createSelectProxy(), { agg: aggregates }),
    ] as AnySelectableField[];
    return {
      go: async (): Promise<FlatFinalResult<S>[]> => {
        const rows = await requireAdapter().execute(sqb);
        return rows.map(mapReturningRow) as FlatFinalResult<S>[];
      },
      sql,
    };
  };

  return {
    where: (clause) => {
      const expression = clause(createFilterProxy());
      if (expression !== undefined) {
        sqb.wheres.elements.push({
          join: 'AND',
          condition: toSqlCondition(expression),
        });
      }
      return { returning, go, sql };
    },
    returning,
    go,
    sql,
  };
}
