import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WhereCondition,
  WhereFragment,
  WhereGroup,
  WhereStep,
  SlotDefinition,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function cond(
  field: string,
  op: string,
  value: unknown,
  alias?: string,
): WhereCondition {
  return { field, op, value, alias };
}

function step(
  join: 'AND' | 'OR',
  condition: WhereStep['condition'],
): WhereStep {
  return { join, condition };
}

function group(elements: WhereStep[]): WhereGroup {
  return { elements };
}

function frag(
  text: string,
  values: unknown[] = [],
  slotOrder: SlotDefinition[] = [],
): WhereFragment {
  return { kind: 'sql-condition', text, values, slotOrder };
}

function sqb(overrides: Partial<ReadonlySqb> = {}): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['User', 'users']]),
    wheres: { elements: [] },
    havings: { elements: [] },
    cursor: { elements: [] },
    selects: null,
    joins: [],
    includes: [],
    orders: [],
    limit: null,
    offset: null,
    groupBy: [],
    updateData: null,
    upsertData: null,
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

describe('SqlGenerator — where-фрагменты (E)', () => {
  const gen = new TestGenerator();

  it('одиночный фрагмент: без скобок, параметр в values', () => {
    const q = sqb({
      wheres: group([step('AND', frag('"User"."age" > $1', [25]))]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain('WHERE "User"."age" > $1');
    expect(r.values).toEqual([25]);
  });

  it('P1: фрагмент с соседями по группе оборачивается в скобки', () => {
    const q = sqb({
      wheres: group([
        step('AND', cond('active', '=', true, 'User')),
        step('AND', frag('"User"."age" = $1 OR "User"."age" = $2', [25, 40])),
      ]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain(
      'WHERE "User"."active" = $1 AND ("User"."age" = $2 OR "User"."age" = $3)',
    );
    expect(r.values).toEqual([true, 25, 40]);
  });

  it('фрагмент после других условий: локальные $N сдвигаются, P1-скобки при соседях', () => {
    const q = sqb({
      wheres: group([
        step('AND', cond('age', '>', 18, 'User')),
        step('AND', frag('"User"."score" > $1', [5])),
        step('AND', cond('active', '=', true, 'User')),
      ]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain(
      'WHERE "User"."age" > $1 AND ("User"."score" > $2) AND "User"."active" = $3',
    );
    expect(r.values).toEqual([18, 5, true]);
  });

  it('slotOrder фрагмента сдвигается на текущий paramIndex', () => {
    const q = sqb({
      wheres: group([
        step('AND', cond('age', '>', 18, 'User')),
        step('AND', frag('x = $1', [5], [{ name: 'v', index: 1 }])),
      ]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain('WHERE "User"."age" > $1 AND (x = $2)');
    expect(r.slotOrder).toEqual([{ name: 'v', index: 2 }]);
  });

  it('дедуп слотов: второй фрагмент с тем же именем не даёт дубль', () => {
    const q = sqb({
      wheres: group([
        step('AND', frag('a = $1', [5], [{ name: 'v', index: 1 }])),
        step('AND', frag('b = $1', [7], [{ name: 'v', index: 1 }])),
      ]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain('WHERE (a = $1) AND (b = $2)');
    expect(r.values).toEqual([5, 7]);
    expect(r.slotOrder).toEqual([{ name: 'v', index: 1 }]);
  });

  it('два фрагмента в выражении-группе: (x) OR (y)', () => {
    const q = sqb({
      wheres: group([
        step(
          'AND',
          group([
            step('OR', frag('a = $1', [1])),
            step('OR', frag('b = $1', [2])),
          ]),
        ),
      ]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain('WHERE (a = $1) OR (b = $2)');
    expect(r.values).toEqual([1, 2]);
  });

  it('смешанная группа с листом-фрагментом: скобки по P1 (корень с OR-шагами)', () => {
    const q = sqb({
      wheres: group([
        step('OR', cond('a', '=', 1, 'u')),
        step('AND', cond('a', '=', 2, 'u')),
        step('OR', frag('x > 0', [])),
      ]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain(
      'WHERE ("u"."a" = $1 AND "u"."a" = $2 OR (x > 0))',
    );
  });

  it('фрагмент в HAVING (resolveBare не затрагивает opaque-лист)', () => {
    const q = sqb({
      havings: group([step('OR', frag('COUNT(*) > $1', [1]))]),
    });
    const r = gen.toSql(q);
    expect(r.text).toContain('HAVING COUNT(*) > $1');
    expect(r.values).toEqual([1]);
  });
});
