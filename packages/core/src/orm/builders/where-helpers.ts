import type { WhereCondition, WhereGroup } from '../ast/where';

/**
 * Добавить OR-условие к WHERE-дереву.
 * Оборачивает предыдущие AND-условия в группу для сохранения приоритета.
 */
export function addOrCondition(
  group: WhereGroup,
  condition: WhereCondition,
): void {
  if (group.conditions.length === 0) {
    group.conditions.push(condition);
    return;
  }
  if (group.op === 'OR') {
    group.conditions.push(condition);
    return;
  }
  if (group.conditions.length === 1) {
    group.op = 'OR';
    group.conditions.push(condition);
  } else {
    const prev: WhereGroup = {
      op: group.op,
      conditions: [...group.conditions],
    };
    group.op = 'OR';
    group.conditions = [prev, condition];
  }
}
