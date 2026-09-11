/**
 * Shared pure helpers for query builders.
 */
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../ir/index';
import type { KadmiumSqb } from '../sqb';
import type { WhereExpression } from '../ast/where';

/** Human-readable SQL preview: "SQL: …\nVALUES: […]". */
export function buildDebugSql(sqb: KadmiumSqb, adapter: SqlAdapter): string {
  const { text, values } = adapter.toSql(sqb);
  return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
}

/** Map a flat database row to model property names via IR aliases. */
export function mapRow(
  ir: ModelIR,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [prop, f] of Object.entries(ir.fields)) {
    const col = f.alias ?? prop;
    if (row[col] !== undefined) out[prop] = row[col];
  }
  return out;
}

/** Push a flat where step; skips undefined expressions. */
export function pushWhere<TProxy>(
  join: 'AND' | 'OR',
  fn: (t: TProxy) => WhereExpression | undefined,
  sqb: KadmiumSqb,
  createProxy: () => TProxy,
): void {
  const expression = fn(createProxy());
  if (expression !== undefined) {
    sqb.wheres.elements.push({ join, condition: expression });
  }
}
