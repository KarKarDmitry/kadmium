import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
  WhereStep,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['u', 'users']]),
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

function where(
  field: string,
  op: string,
  value: unknown,
  alias = 'u',
): WhereCondition {
  return { field, op, value, alias };
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

/** Стандартный multi-key курсор: or(name > M, and(name = M, id < 500)) */
function multiKeyCursor(elements: WhereStep[] = []): WhereStep[] {
  return [
    step(
      'AND',
      group([
        step('OR', where('name', '>', 'M')),
        step('OR', group([step('AND', where('name', '=', 'M')), step('AND', where('id', '<', 500))])),
      ]),
    ),
  ];
}

describe('SqlGenerator — toSql: cursor (keyset)', () => {
  const gen = new TestGenerator();

  it('cursor single-key with empty wheres', () => {
    const q = sqb({ cursor: group([step('AND', where('id', '>', 42))]) });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('WHERE ("u"."id" > $1)');
    expect(values).toEqual([42]);
  });

  it('cursor after pure-AND wheres, no extra parens on main', () => {
    const q = sqb({
      wheres: group([step('AND', where('age', '=', 30)), step('AND', where('active', '=', true))]),
      cursor: group([step('AND', where('id', '>', 42))]),
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'WHERE "u"."age" = $1 AND "u"."active" = $2 AND ("u"."id" > $3)',
    );
    expect(values).toEqual([30, true, 42]);
  });

  it('cursor after wheres with OR — main wrapped in parens', () => {
    const q = sqb({
      wheres: group([step('AND', where('age', '=', 30)), step('OR', where('active', '=', true))]),
      cursor: group([step('AND', where('id', '>', 42))]),
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'WHERE ("u"."age" = $1 OR "u"."active" = $2) AND ("u"."id" > $3)',
    );
    expect(values).toEqual([30, true, 42]);
  });

  it('OR-composite cursor after pure-AND wheres', () => {
    const q = sqb({
      wheres: group([step('AND', where('age', '=', 30))]),
      cursor: group(multiKeyCursor()),
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'WHERE "u"."age" = $1 AND ("u"."name" > $2 OR ("u"."name" = $3 AND "u"."id" < $4))',
    );
    expect(values).toEqual([30, 'M', 'M', 500]);
  });

  it('OR-composite cursor after wheres with OR — both parenthesized', () => {
    const q = sqb({
      wheres: group([step('AND', where('age', '=', 30)), step('OR', where('active', '=', true))]),
      cursor: group(multiKeyCursor()),
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'WHERE ("u"."age" = $1 OR "u"."active" = $2) AND ("u"."name" > $3 OR ("u"."name" = $4 AND "u"."id" < $5))',
    );
    expect(values).toEqual([30, true, 'M', 'M', 500]);
  });

  it('OR-composite cursor as the only condition', () => {
    const q = sqb({ cursor: group(multiKeyCursor()) });
    const { text, values } = gen.toSql(q);
    expect(text).toContain(
      'WHERE ("u"."name" > $1 OR ("u"."name" = $2 AND "u"."id" < $3))',
    );
    expect(values).toEqual(['M', 'M', 500]);
  });

  it('cursor composes with ORDER BY and LIMIT', () => {
    const q = sqb({
      cursor: group([step('AND', where('id', '>', 42))]),
      orders: [{ field: 'id', direction: 'asc' }],
      limit: 10,
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('WHERE ("u"."id" > $1)');
    expect(text).toContain('ORDER BY "u"."id" ASC');
    expect(text).toContain('LIMIT $2');
    expect(values).toEqual([42, 10]);
  });

  it('empty cursor group adds no WHERE', () => {
    const q = sqb({});
    const { text } = gen.toSql(q);
    expect(text).not.toContain('WHERE');
  });
});