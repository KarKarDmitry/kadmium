import { describe, it, expect } from 'vitest';
import { addOrCondition } from '../../src/orm/builders/where-helpers';
import type { WhereGroup, WhereCondition } from '../../src/orm/ast/where';

function cond(field: string): WhereCondition {
  return { field, op: '=', value: field };
}

describe('addOrCondition', () => {
  it('empty group — pushes condition directly', () => {
    const group: WhereGroup = { op: 'AND', conditions: [] };
    addOrCondition(group, cond('a'));

    expect(group.op).toBe('AND');
    expect(group.conditions.length).toBe(1);
    expect(group.conditions[0]).toEqual(cond('a'));
  });

  it('single AND → flips to OR', () => {
    const group: WhereGroup = { op: 'AND', conditions: [cond('a')] };
    addOrCondition(group, cond('b'));

    expect(group.op).toBe('OR');
    expect(group.conditions.length).toBe(2);
    expect(group.conditions[0]).toEqual(cond('a'));
    expect(group.conditions[1]).toEqual(cond('b'));
  });

  it('multiple AND → wraps previous in sub-group', () => {
    const group: WhereGroup = {
      op: 'AND',
      conditions: [cond('a'), cond('b')],
    };
    addOrCondition(group, cond('c'));

    expect(group.op).toBe('OR');
    expect(group.conditions.length).toBe(2);
    // First child is the wrapped AND group
    const sub = group.conditions[0] as WhereGroup;
    expect(sub.op).toBe('AND');
    expect(sub.conditions.length).toBe(2);
    expect(sub.conditions[0]).toEqual(cond('a'));
    expect(sub.conditions[1]).toEqual(cond('b'));
    // Second child is the new OR condition
    expect(group.conditions[1]).toEqual(cond('c'));
  });

  it('already OR — appends', () => {
    const group: WhereGroup = {
      op: 'OR',
      conditions: [cond('a'), cond('b')],
    };
    addOrCondition(group, cond('c'));

    expect(group.op).toBe('OR');
    expect(group.conditions.length).toBe(3);
    expect(group.conditions[2]).toEqual(cond('c'));
  });

  it('wrapping group preserves AND op', () => {
    const group: WhereGroup = {
      op: 'AND',
      conditions: [cond('a'), cond('b'), cond('c')],
    };
    addOrCondition(group, cond('d'));

    const sub = group.conditions[0] as WhereGroup;
    expect(sub.op).toBe('AND');
    expect(sub.conditions.length).toBe(3);
  });
});
