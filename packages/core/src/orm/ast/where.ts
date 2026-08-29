/** WhereCondition / WhereGroup — дерево условий */

export type WhereCondition = {
  alias?: string;
  field: string;
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
