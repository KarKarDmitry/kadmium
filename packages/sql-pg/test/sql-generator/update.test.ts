import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
  SelectItem,
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

/** Поле, повторяющее реальный SelectableField.toSql() из core. */
function selectable(
  tableAlias: string,
  fieldName: string,
  alias?: string,
  column?: string,
): SelectItem {
  return {
    kind: 'selectable',
    tableAlias,
    fieldName,
    alias,
    column,
    toSql: () => {
      const col = column ?? fieldName;
      return alias
        ? `"${tableAlias}"."${col}" AS "${alias}"`
        : `"${tableAlias}"."${col}"`;
    },
  };
}

/** Агрегат, повторяющий реальный AggregateField.toSql() из core. */
function aggregate(sql: string, alias: string): SelectItem {
  return {
    kind: 'aggregate',
    tableAlias: 'u',
    fieldName: '*',
    alias,
    toSql: () => `${sql} AS "${alias}"`,
  };
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

  it('RETURNING selected field with alias', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob' },
      selects: [selectable('u', 'name', 'displayName')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING "u"."name" AS "displayName"');
  });

  it('RETURNING field without alias', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob' },
      selects: [selectable('u', 'name')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING "u"."name"');
  });

  it('RETURNING aggregate', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob' },
      selects: [aggregate('COUNT(*)', 'total')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING COUNT(*) AS "total"');
  });

  it('RETURNING mixed field and aggregate', () => {
    const q = sqb({
      operation: 'update',
      updateData: { name: 'Bob' },
      selects: [selectable('u', 'id'), aggregate('COUNT(*)', 'total')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING "u"."id", COUNT(*) AS "total"');
  });
});
