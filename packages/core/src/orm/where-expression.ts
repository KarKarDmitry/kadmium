import type { WhereExpression, WhereGroup, WhereStep } from './ast/where';

/**
 * Комбинаторы WHERE-выражений.
 *
 * Создают WhereGroup. При вложенности в другую группу рендерятся в скобках,
 * если op группы отличается от контекста (минимальные скобки, см. sql-pg).
 *
 * `undefined`-аргументы пропускаются (условные фильтры); если значимых
 * аргументов нет, возвращается `undefined` — шаг не добавляется в WHERE.
 */
export function and(
  ...expressions: Array<WhereExpression | undefined>
): WhereGroup | undefined {
  return buildGroup('AND', expressions);
}

export function or(
  ...expressions: Array<WhereExpression | undefined>
): WhereGroup | undefined {
  return buildGroup('OR', expressions);
}

function buildGroup(
  join: WhereStep['join'],
  expressions: Array<WhereExpression | undefined>,
): WhereGroup | undefined {
  const elements = expressions
    .filter((e): e is WhereExpression => e !== undefined)
    .map((condition): WhereStep => ({ join, condition }));
  if (elements.length === 0) return undefined;
  return { elements };
}
