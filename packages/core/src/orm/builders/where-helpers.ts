import type { WhereCondition, WhereGroup } from '../ast/where';

/**
 * Обёрнуть callback в дочернюю WhereGroup: временно подменяет целевое поле sqb
 * на новую группу; результат пушится в родителя как вложенная группа (скобки).
 * Используется for WHERE (group()) и HAVING (havingGroup()).
 */
export function withChildGroup(
  sqb: { wheres: WhereGroup; havings: WhereGroup },
  target: 'wheres' | 'havings',
  callback: () => void,
): void {
  const parent = sqb[target];
  const child: WhereGroup = { op: 'AND', conditions: [] };
  sqb[target] = child;
  try {
    callback();
  } finally {
    if (child.conditions.length > 0) {
      parent.conditions.push(child);
    }
    sqb[target] = parent;
  }
}

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
