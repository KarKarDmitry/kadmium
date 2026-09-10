/**
 * WhereCondition / WhereGroup — дерево условий.
 *
 * Модель: группа = линейная последовательность шагов (join + условие).
 * Биlder-методы (where/and/or) пушат шаги без авто-группировки — топ-уровень
 * плоский, приоритет у PostgreSQL. Группы создаются только выражениями
 * (and()/or()) и при вложенности выводятся в скобках (минимальные скобки —
 * parens там, где op ребёнка отличается от контекста, см. sql-pg).
 */

export type WhereCondition = {
  alias?: string;
  /** Имя свойства (ключ результата / типизация) */
  field: string;
  /** Имя колонки в БД (FieldIR.alias ?? field) */
  column?: string;
  op: string;
  value: unknown;
};

/** Шаг последовательности: с каким join присоединяется условие */
export type WhereStep = {
  join: 'AND' | 'OR';
  condition: WhereCondition | WhereGroup;
};

export type WhereGroup = {
  elements: WhereStep[];
};

export type WhereExpression = WhereCondition | WhereGroup;

export function createWhereGroup(): WhereGroup {
  return { elements: [] };
}
