import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  WhereCondition,
  WhereGroup,
} from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

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

describe('SqlGenerator — _buildWhereGroupSql', () => {
  const gen = new TestGenerator();

  it('returns empty string for empty conditions', () => {
    const g = group('AND', []);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe('');
  });

  it('renders a single condition', () => {
    const g = group('AND', [where('name', '=', 'Alice', 'u')]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe('"u"."name" = $1');
    expect(values).toEqual(['Alice']);
  });

  it('renders AND between conditions', () => {
    const g = group('AND', [
      where('name', '=', 'Alice', 'u'),
      where('age', '>', 18, 'u'),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."name" = $1 AND "u"."age" > $2',
    );
    expect(values).toEqual(['Alice', 18]);
  });

  it('renders OR between conditions', () => {
    const g = group('OR', [
      where('name', '=', 'Alice', 'u'),
      where('name', '=', 'Bob', 'u'),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."name" = $1 OR "u"."name" = $2',
    );
  });

  it('renders nested groups with parentheses', () => {
    const g = group('AND', [
      where('active', '=', true, 'u'),
      group('OR', [
        where('name', '=', 'Alice', 'u'),
        where('name', '=', 'Bob', 'u'),
      ]),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."active" = $1 AND ("u"."name" = $2 OR "u"."name" = $3)',
    );
    expect(values).toEqual([true, 'Alice', 'Bob']);
  });

  it('uses column over field when column is set', () => {
    const g = group('AND', [where('name', '=', 'Alice', 'u', 'display_name')]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."display_name" = $1',
    );
  });
});

describe('SqlGenerator — _buildWhereClause', () => {
  const gen = new TestGenerator();

  it('returns empty string when no conditions and no extras', () => {
    const g = group('AND', []);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereClause'](g, values, p, [])).toBe('');
  });

  it('renders WHERE from conditions', () => {
    const g = group('AND', [where('name', '=', 'Alice', 'u')]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereClause'](g, values, p, [])).toBe(
      'WHERE "u"."name" = $1',
    );
  });

  it('appends extraConditions with AND', () => {
    const g = group('AND', [where('name', '=', 'Alice', 'u')]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereClause'](g, values, p, ['"u"."id" = t.id'])).toBe(
      'WHERE "u"."name" = $1 AND "u"."id" = t.id',
    );
  });
});
