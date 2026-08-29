/** WhereCondition / WhereGroup — дерево условий */

export type WhereCondition = {
  alias?: string;
  /** Имя свойства (ключ результата / типизация) */
  field: string;
  /** Имя колонки в БД (FieldIR.alias ?? field) */
  column?: string;
  op: string;
  value: unknown;
};

export type WhereGroup = {
  op: 'AND' | 'OR';
  conditions: Array<WhereCondition | WhereGroup>;
};

export function createWhereGroup(): WhereGroup {
  return { op: 'AND', conditions: [] };
}
