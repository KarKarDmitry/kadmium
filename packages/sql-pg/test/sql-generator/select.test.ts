import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
  SelectableField,
  AggregateSelectable,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['u', 'users']]),
    wheres: { op: 'AND', conditions: [] },
    havings: { op: 'AND', conditions: [] },
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

function selectable(
  tableAlias: string,
  fieldName: string,
  alias?: string,
  column?: string,
): SelectableField {
  return {
    kind: 'selectable',
    tableAlias,
    fieldName,
    alias,
    column,
    toSql: () => `"${tableAlias}"."${column ?? fieldName}"`,
  };
}

function aggregate(
  tableAlias: string,
  func: string,
  alias: string,
): AggregateSelectable {
  return {
    kind: 'aggregate',
    tableAlias,
    fieldName: '*',
    alias,
    func,
    toSql: () => `${func.toUpperCase()}(*) AS "${alias}"`,
  };
}

describe('SqlGenerator — toSql: select', () => {
  const gen = new TestGenerator();

  it('wildcard select when no selects', () => {
    const q = sqb({});
    const { text } = gen.toSql(q);
    expect(text).toContain('SELECT "u".*');
    expect(text).toContain('FROM "users" AS "u"');
  });

  it('select with explicit alias', () => {
    const q = sqb({
      selects: [selectable('u', 'name', 'displayName')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('SELECT "u"."name" AS "displayName"');
  });

  it('select without alias on single table', () => {
    const q = sqb({
      selects: [selectable('u', 'name')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('SELECT "u"."name" AS "name"');
  });

  it('select on multi-table uses table-qualified alias', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
      selects: [selectable('u', 'name')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('SELECT "u"."name" AS "u.name"');
  });

  it('select with aggregate', () => {
    const q = sqb({
      selects: [aggregate('u', 'count', 'total')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('COUNT(*) AS "total"');
  });

  it('mixed selectable and aggregate', () => {
    const q = sqb({
      selects: [
        selectable('u', 'id', undefined),
        aggregate('u', 'count', 'total'),
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('"u"."id" AS "id"');
    expect(text).toContain('COUNT(*) AS "total"');
  });

  it('single table FROM', () => {
    const q = sqb({});
    const { text } = gen.toSql(q);
    expect(text).toContain('FROM "users" AS "u"');
  });

  it('INNER JOIN', () => {
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
            { getIdentifierForSql: () => '"p"."authorId"' },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain(
      'INNER JOIN "posts" AS "p" ON "u"."id" = "p"."authorId"',
    );
  });

  it('LEFT JOIN', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
      joins: [
        {
          left: 'u',
          right: 'p',
          direction: 'left',
          on: where(
            'id',
            '=',
            { getIdentifierForSql: () => '"p"."authorId"' },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('LEFT JOIN "posts" AS "p"');
  });

  it('RIGHT JOIN', () => {
    const q = sqb({
      tableContext: new Map([
        ['u', 'users'],
        ['p', 'posts'],
      ]),
      joins: [
        {
          left: 'u',
          right: 'p',
          direction: 'right',
          on: where(
            'id',
            '=',
            { getIdentifierForSql: () => '"p"."authorId"' },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RIGHT JOIN "posts" AS "p"');
  });

  it('defaults join direction to INNER', () => {
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
            { getIdentifierForSql: () => '"p"."authorId"' },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('INNER JOIN');
  });

  it('two islands produce comma-separated FROM', () => {
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
            { getIdentifierForSql: () => '"p"."authorId"' },
            'u',
          ),
        },
      ],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('"users" AS "u"');
    expect(text).toContain('"tags" AS "t"');
    expect(text).toMatch(
      /FROM "users" AS "u" INNER JOIN "posts" AS "p".*, "tags" AS "t"/,
    );
  });

  it('WHERE + ORDER BY + LIMIT', () => {
    const q = sqb({
      wheres: group('AND', [where('name', '=', 'Alice', 'u')]),
      orders: [{ field: 'name', direction: 'asc' }],
      limit: 10,
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('WHERE "u"."name" = $1');
    expect(text).toContain('ORDER BY "u"."name" ASC');
    expect(text).toContain('LIMIT $2');
    expect(values).toEqual(['Alice', 10]);
  });

  it('ORDER BY DESC', () => {
    const q = sqb({
      orders: [{ field: 'createdAt', direction: 'desc' }],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('ORDER BY "u"."createdAt" DESC');
  });

  it('GROUP BY', () => {
    const q = sqb({
      selects: [selectable('u', 'id'), aggregate('u', 'count', 'total')],
      groupBy: ['id'],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('GROUP BY "u"."id"');
  });

  it('HAVING after GROUP BY resolves aggregate alias to expression', () => {
    const q = sqb({
      selects: [selectable('u', 'id'), aggregate('u', 'count', 'total')],
      groupBy: ['id'],
      havings: {
        op: 'AND',
        conditions: [where('total', '>', 5, '')],
      },
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('GROUP BY "u"."id"');
    expect(text.trim()).toMatch(/HAVING COUNT\(\*\) > \$1$/);
    expect(values).toEqual([5]);
  });

  it('HAVING without GROUP BY resolves aggregate alias to expression', () => {
    const q = sqb({
      selects: [aggregate('u', 'count', 'total')],
      havings: {
        op: 'AND',
        conditions: [where('total', '>', 3, '')],
      },
    });
    const { text, values } = gen.toSql(q);
    expect(text.trim()).toMatch(/HAVING COUNT\(\*\) > \$1$/);
    expect(values).toEqual([3]);
  });

  it('OFFSET', () => {
    const q = sqb({
      offset: 20,
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('OFFSET $1');
    expect(values).toEqual([20]);
  });

  it('LIMIT + OFFSET together', () => {
    const q = sqb({
      limit: 10,
      offset: 20,
    });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('LIMIT $1');
    expect(text).toContain('OFFSET $2');
    expect(values).toEqual([10, 20]);
  });

  it('no WHERE when conditions are empty', () => {
    const q = sqb({});
    const { text } = gen.toSql(q);
    expect(text).not.toContain('WHERE');
  });
});
