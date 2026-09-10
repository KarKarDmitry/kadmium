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
  alias?: string,
  column?: string,
): WhereCondition {
  return { field, op, value, alias, column };
}

function group(
  join: 'AND' | 'OR',
  conditions: WhereCondition[],
): WhereGroup {
  return { elements: conditions.map((condition) => ({ join, condition })) };
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

  it('RETURNING selected field with alias', () => {
    const q = sqb({
      operation: 'delete',
      selects: [selectable('u', 'name', 'displayName')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING "u"."name" AS "displayName"');
  });

  it('RETURNING aggregate', () => {
    const q = sqb({
      operation: 'delete',
      selects: [aggregate('COUNT(*)', 'total')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING COUNT(*) AS "total"');
  });

  it('RETURNING mixed field and aggregate', () => {
    const q = sqb({
      operation: 'delete',
      selects: [selectable('u', 'id'), aggregate('COUNT(*)', 'total')],
    });
    const { text } = gen.toSql(q);
    expect(text).toContain('RETURNING "u"."id", COUNT(*) AS "total"');
  });
});
