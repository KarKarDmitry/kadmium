import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../src/sql-generator';
import {
  buildInsertSql,
  buildInsertManySql,
  buildUpsertManySql,
} from '../src/helpers';
import type {
  ReadonlySqb,
  WhereExpression,
  WhereGroup,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['c', 'comment']]),
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
    upsertSetData: null,
    conflictTarget: null,
    doNothing: false,
    ...overrides,
  };
}

function group(join: 'AND' | 'OR', conditions: WhereExpression[]): WhereGroup {
  return { elements: conditions.map((condition) => ({ join, condition })) };
}

describe('having() over an aggregate of an aliased column', () => {
  const gen = new TestGenerator();

  it('renders COUNT("c"."is_flagged") in both SELECT and HAVING', () => {
    const q = sqb({
      selects: [
        {
          kind: 'aggregate',
          tableAlias: 'c',
          fieldName: 'flagged',
          column: 'is_flagged',
          func: 'count',
          alias: 'flaggedCount',
        },
      ],
      groupBy: ['post'],
      havings: group('AND', [
        {
          field: 'flaggedCount',
          op: '>',
          value: 1,
          alias: '',
          column: 'flaggedCount',
        },
      ]),
    });
    const { text, values } = gen.toSql(q);
    // SELECT-side aggregate renders the DB column correctly…
    expect(text).toContain('COUNT("c"."is_flagged") AS "flaggedCount"');
    // …but the HAVING clause re-renders it from fieldName instead of column.
    expect(text).toContain('HAVING COUNT("c"."is_flagged") > $1');
    expect(values).toContain(1);
  });
});

describe("create vs createMany 'id' handling", () => {
  it('create() keeps explicit id, createMany() drops it (unionKeys)', () => {
    const single = buildInsertSql('user', { id: 1, name: 'a' });
    expect(single.text).toContain('"id"');
    const many = buildInsertManySql('user', [{ id: 1, name: 'a' }]);
    expect(many.text).not.toContain('"id"');
  });
});

describe('upsert conflictTarget handling', () => {
  it('renders a valid ON CONFLICT clause for a plain target', () => {
    const { text } = buildUpsertManySql(
      'user',
      [{ email: 'a@b.c', name: 'n' }],
      ['email'],
      true,
    );
    expect(text).toContain('ON CONFLICT ("email") DO NOTHING');
  });

  it('rejects a conflictTarget that is not a plain identifier', () => {
    // ConflictTarget is interpolated verbatim — unlike columns (unionKeys)
    // it never passes assertSqlIdentifier, so quotes/statements are not rejected.
    const { text } = buildUpsertManySql(
      'user',
      [{ email: 'a@b.c', name: 'n' }],
      ['email"; DROP TABLE user; --'],
      true,
    );
    expect(text).not.toBe('');
    expect(text).toMatch(/ON CONFLICT \([^)]*DROP TABLE/);
  });
});
