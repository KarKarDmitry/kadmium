import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type { ReadonlySqb, WhereCondition } from '@karkardmitry/kadmium-sql-types';

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

describe('SqlGenerator — toSql: join islands', () => {
  const gen = new TestGenerator();

  it('single JOIN produces one island with JOIN', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
      joins: [
        {
          left: 'u',
          right: 'p',
          on: where(
            'id',
            '=',
            {
              getIdentifierForSql: () => '"p"."authorId"',
            },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('FROM "users" AS "u" INNER JOIN "posts" AS "p"');
  });

  it('two disconnected tables produce comma-separated islands', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
        ['t', 'tags'],
      ]),
      joins: [
        {
          left: 'u',
          right: 'p',
          on: where(
            'id',
            '=',
            {
              getIdentifierForSql: () => '"p"."authorId"',
            },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('"tags" AS "t"');
    expect(text).toMatch(
      /"users" AS "u" INNER JOIN "posts" AS "p".*"tags" AS "t"/,
    );
  });

  it('chain of JOINs produces single island', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
        ['c', 'comments'],
      ]),
      joins: [
        {
          left: 'u',
          right: 'p',
          on: where(
            'id',
            '=',
            {
              getIdentifierForSql: () => '"p"."authorId"',
            },
            'u',
          ),
        },
        {
          left: 'p',
          right: 'c',
          on: where(
            'id',
            '=',
            {
              getIdentifierForSql: () => '"c"."postId"',
            },
            'p',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('INNER JOIN "posts" AS "p"');
    expect(text).toContain('INNER JOIN "comments" AS "c"');
  });

  it('self-join pushes condition to WHERE', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['m', 'users'],
      ]),
      joins: [
        {
          left: 'u',
          right: 'm',
          on: where(
            'managerId',
            '=',
            {
              getIdentifierForSql: () => '"m"."id"',
            },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('FROM "users" AS "u"');
    expect(text).toContain('"u"."managerId" = "m"."id"');
  });
});
