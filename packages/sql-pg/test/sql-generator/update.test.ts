import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['u', 'users']]),
    wheres: { op: 'AND', conditions: [] },
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
  alias?: string,
  column?: string,
): WhereCondition {
  return { field, op, value, alias, column };
}

function group(
  op: 'AND' | 'OR',
  conditions: Array<WhereCondition | WhereGroup>,
): WhereGroup {
  return { op, conditions };
}

describe('SqlGenerator — toSql: update', () => {
  const gen = new TestGenerator();

  it('UPDATE SET with WHERE and RETURNING', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob' },
      wheres: group('AND', [where('id', '=', 1, 'u')]),
    });
    const { text, values } = gen.toSql(q);
    expect(text).toBe(
      'UPDATE "users" AS "u" SET "name" = $1 WHERE "u"."id" = $2 RETURNING *',
    );
    expect(values).toEqual(['Bob', 1]);
  });

  it('UPDATE with multiple SET fields', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob', email: 'bob@test.com' },
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('SET "name" = $1, "email" = $2');
    expect(text).toContain('RETURNING *');
    expect(values).toEqual(['Bob', 'bob@test.com']);
  });

  it('UPDATE without WHERE', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob' },
    });
    const { text } = gen.toSql(q);
    expect(text).not.toContain('WHERE');
    expect(text).toContain('RETURNING *');
  });

  it('throws when tableContext has more than one table', () => {
    const q = sqb({
      operation: 'update',
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
      updateData: { name: 'Bob' },
    });
    expect(() => gen.toSql(q)).toThrow('UPDATE requires exactly one table');
  });

  it('throws when no updateData', () => {
    const q = sqb({
      operation: 'update',
      updateData: null,
    });
    expect(() => gen.toSql(q)).toThrow('No data provided for UPDATE');
  });
});
