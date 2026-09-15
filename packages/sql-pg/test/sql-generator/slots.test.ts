import { describe, it, expect } from 'vitest';
import {
  SqlGenerator,
  assertNoUnfilledSlots,
  isHoleRef,
  type ParamState,
} from '../../src/sql-generator';
import type {
  WhereCondition,
  WhereGroup,
  WhereStep,
  HoleRef,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function where(
  field: string,
  op: string,
  value: unknown,
  alias?: string,
  column?: string,
): WhereCondition {
  return { field, op, value, alias, column };
}

function step(
  join: 'AND' | 'OR',
  condition: WhereCondition | WhereGroup,
): WhereStep {
  return { join, condition };
}

function group(elements: WhereStep[]): WhereGroup {
  return { elements };
}

function hole(name: string): HoleRef {
  return { kind: 'slot', slotName: name };
}

describe('SqlGenerator — slot markers', () => {
  const gen = new TestGenerator();
  const state = (p: number, slotOrder: { name: string; index: number }[] = []) =>
    ({ p, slotOrder }) as ParamState;

  it('renders a slot as $N and records slotOrder', () => {
    const w = where('id', '=', hole('tenantId'), 'u');
    const values: unknown[] = [];
    const param = state(1);
    expect(gen['_renderValue'](w, values, param)).toBe('$1');
    expect(values).toEqual([hole('tenantId')]);
    expect(param.slotOrder).toEqual([{ name: 'tenantId', index: 1 }]);
  });

  it('numbers slots after preceding primitive params in a group', () => {
    const g = group([
      step('AND', where('name', '=', 'Alice', 'u')),
      step('AND', where('tenant_id', '=', hole('tenantId'), 'u')),
    ]);
    const values: unknown[] = [];
    const param = state(1);
    expect(gen['_buildWhereGroupSql'](g, values, param)).toBe(
      '"u"."name" = $1 AND "u"."tenant_id" = $2',
    );
    expect(values).toEqual(['Alice', hole('tenantId')]);
    expect(param.slotOrder).toEqual([{ name: 'tenantId', index: 2 }]);
  });

  it('dedups slotOrder by name keeping the first index', () => {
    const g = group([
      step('AND', where('id', '=', hole('x'), 'u')),
      step('AND', where('tenant_id', '=', hole('x'), 'u')),
    ]);
    const values: unknown[] = [];
    const param = state(1);
    gen['_buildWhereGroupSql'](g, values, param);
    expect(values).toEqual([hole('x'), hole('x')]);
    expect(param.slotOrder).toEqual([{ name: 'x', index: 1 }]);
  });

  it('renders a marker as param, not as a field identifier (branch order)', () => {
    const fake = {
      kind: 'slot',
      slotName: 'y',
      getIdentifierForSql: () => '"u"."y"',
    };
    const w = where('id', '=', fake, 'u');
    const values: unknown[] = [];
    const param = state(1);
    expect(gen['_renderValue'](w, values, param)).toBe('$1');
    expect(values).toEqual([fake]);
    expect(param.slotOrder).toEqual([{ name: 'y', index: 1 }]);
  });
});

describe('assertNoUnfilledSlots', () => {
  it('passes when no markers present', () => {
    expect(() => assertNoUnfilledSlots(['a', 1, null])).not.toThrow();
  });

  it('throws listing unique unfilled slot names', () => {
    expect(() =>
      assertNoUnfilledSlots([hole('a'), 1, hole('a'), hole('b')]),
    ).toThrow(/Unfilled slot\(s\): a, b/);
  });

  it('passes on an empty values array', () => {
    expect(() => assertNoUnfilledSlots([])).not.toThrow();
  });
});

describe('isHoleRef (sql-pg duck-typing)', () => {
  it('only matches slot markers', () => {
    expect(isHoleRef(hole('x'))).toBe(true);
    expect(isHoleRef({ kind: 'other' })).toBe(false);
    expect(isHoleRef({ slotName: 'x' })).toBe(false);
    expect(isHoleRef(null)).toBe(false);
    expect(isHoleRef('x')).toBe(false);
  });
});