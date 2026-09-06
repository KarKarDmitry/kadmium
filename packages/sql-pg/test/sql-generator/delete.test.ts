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

describe('SqlGenerator — toSql: delete', () => {
  const gen = new TestGenerator();

  it('DELETE with WHERE and RETURNING', () => {
    const q = sqb({
      operation: 'delete',
      wheres: group('AND', [where('id', '=', 1, 'u')]),
    });
    const { text, values } = gen.toSql(q);
    expect(text).toBe(
      'DELETE FROM "users" AS "u" WHERE "u"."id" = $1 RETURNING *',
    );
    expect(values).toEqual([1]);
  });

  it('DELETE without WHERE deletes all rows', () => {
    const q = sqb({ operation: 'delete' });
    const { text } = gen.toSql(q);
    expect(text).toBe('DELETE FROM "users" AS "u" RETURNING *');
  });

  it('throws when tableContext has more than one table', () => {
    const q = sqb({
      operation: 'delete',
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
    });
    expect(() => gen.toSql(q)).toThrow('DELETE requires exactly one table');
  });

  it('throws for unknown operation', () => {
    const q = sqb({ operation: 'select' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (q as any).operation = 'drop';
    expect(() => gen.toSql(q)).toThrow('Operation "drop" not implemented');
  });
});
