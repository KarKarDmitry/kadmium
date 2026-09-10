import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  ReadonlySqb,
  WhereCondition,
  WhereGroup,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function sqb(overrides: Partial<ReadonlySqb>): ReadonlySqb {
  return {
    operation: 'select',
    tableContext: new Map([['u', 'users']]),
    wheres: { elements: [] },
    havings: { elements: [] },
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

function includedRelation(
  overrides: Partial<IncludedRelation> & { propertyName: string },
): IncludedRelation {
  return {
    parentAlias: 'u',
    relationType: 'many-to-one',
    parentField: 'id',
    childField: 'authorId',
    internalSqb: sqb({}),
    targetIr: {
      name: 'Post',
      collection: 'posts',
      fields: {
        id: { alias: 'id' },
        title: { alias: 'title' },
      },
    },
    ...overrides,
  };
}

describe('SqlGenerator — toSql: includes', () => {
  const gen = new TestGenerator();

  it('many-to-one include with row_to_json', () => {
    const inc = includedRelation({
      propertyName: 'author',
      relationType: 'many-to-one',
      parentField: 'authorId',
      childField: 'id',
    });
    const q = sqb({ includes: [inc] });
    const { text } = gen.toSql(q);
    expect(text).toContain('row_to_json(subq)');
    expect(text).toContain('LEFT JOIN LATERAL');
    expect(text).toContain('"__inc_author"."author" AS "author"');
  });

  it('one-to-many include with json_agg', () => {
    const inc = includedRelation({
      propertyName: 'posts',
      relationType: 'one-to-many',
      parentField: 'id',
      childField: 'authorId',
      targetIr: {
        name: 'Post',
        collection: 'posts',
        fields: { id: { alias: 'id' }, title: { alias: 'title' } },
      },
    });
    const q = sqb({ includes: [inc] });
    const { text } = gen.toSql(q);
    expect(text).toContain("COALESCE(json_agg(subq), '[]'::json)");
    expect(text).toContain('LEFT JOIN LATERAL');
  });

  it('one-to-one include with row_to_json', () => {
    const inc = includedRelation({
      propertyName: 'profile',
      relationType: 'one-to-one',
      parentField: 'id',
      childField: 'userId',
    });
    const q = sqb({ includes: [inc] });
    const { text } = gen.toSql(q);
    expect(text).toContain('row_to_json(subq)');
  });

  it('include with WHERE in subquery', () => {
    const inc = includedRelation({
      propertyName: 'posts',
      relationType: 'one-to-many',
      parentField: 'id',
      childField: 'authorId',
      internalSqb: sqb({
        wheres: group('AND', [where('published', '=', true, 'posts')]),
      }),
      targetIr: {
        name: 'Post',
        collection: 'posts',
        fields: { id: { alias: 'id' } },
      },
    });
    const q = sqb({ includes: [inc] });
    const { text } = gen.toSql(q);
    expect(text).toContain('"posts"."published" = $1');
  });

  it('include with ORDER BY in subquery', () => {
    const inc = includedRelation({
      propertyName: 'posts',
      relationType: 'one-to-many',
      parentField: 'id',
      childField: 'authorId',
      internalSqb: sqb({
        orders: [{ field: 'createdAt', direction: 'desc' }],
      }),
      targetIr: {
        name: 'Post',
        collection: 'posts',
        fields: { id: { alias: 'id' } },
      },
    });
    const q = sqb({ includes: [inc] });
    const { text } = gen.toSql(q);
    expect(text).toContain('ORDER BY "posts"."createdAt" DESC');
  });

  it('include with LIMIT in subquery', () => {
    const inc = includedRelation({
      propertyName: 'posts',
      relationType: 'one-to-many',
      parentField: 'id',
      childField: 'authorId',
      internalSqb: sqb({ limit: 5 }),
      targetIr: {
        name: 'Post',
        collection: 'posts',
        fields: { id: { alias: 'id' } },
      },
    });
    const q = sqb({ includes: [inc] });
    const { text, values } = gen.toSql(q);
    expect(text).toContain('LIMIT $1');
    expect(values).toEqual([5]);
  });
});
