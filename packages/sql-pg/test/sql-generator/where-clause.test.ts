import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type {
  WhereCondition,
  WhereGroup,
  WhereStep,
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

function step(
  join: 'AND' | 'OR',
  condition: WhereCondition | WhereGroup,
): WhereStep {
  return { join, condition };
}

function group(elements: WhereStep[]): WhereGroup {
  return { elements };
}

describe('SqlGenerator — _buildWhereGroupSql', () => {
  const gen = new TestGenerator();

  it('returns empty string for empty elements', () => {
    const g = group([]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe('');
  });

  it('renders a single condition', () => {
    const g = group([step('AND', where('name', '=', 'Alice', 'u'))]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe('"u"."name" = $1');
    expect(values).toEqual(['Alice']);
  });

  it('renders AND between conditions', () => {
    const g = group([
      step('AND', where('name', '=', 'Alice', 'u')),
      step('AND', where('age', '>', 18, 'u')),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."name" = $1 AND "u"."age" > $2',
    );
    expect(values).toEqual(['Alice', 18]);
  });

  it('renders OR between conditions', () => {
    const g = group([
      step('OR', where('name', '=', 'Alice', 'u')),
      step('OR', where('name', '=', 'Bob', 'u')),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."name" = $1 OR "u"."name" = $2',
    );
  });

  it('renders nested groups with parentheses when join differs', () => {
    const g = group([
      step('AND', where('active', '=', true, 'u')),
      step(
        'AND',
        group([
          step('OR', where('name', '=', 'Alice', 'u')),
          step('OR', where('name', '=', 'Bob', 'u')),
        ]),
      ),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."active" = $1 AND ("u"."name" = $2 OR "u"."name" = $3)',
    );
    expect(values).toEqual([true, 'Alice', 'Bob']);
  });

  it('renders nested group without parens when join matches', () => {
    const g = group([
      step('AND', where('a', '=', 1, 'u')),
      step(
        'AND',
        group([
          step('AND', where('b', '=', 2, 'u')),
          step('AND', where('c', '=', 3, 'u')),
        ]),
      ),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."a" = $1 AND "u"."b" = $2 AND "u"."c" = $3',
    );
  });

  it('renders mixed nested group with parentheses', () => {
    const g = group([
      step('AND', where('a', '=', 1, 'u')),
      step(
        'AND',
        group([
          step('AND', where('b', '=', 2, 'u')),
          step('OR', where('c', '=', 3, 'u')),
        ]),
      ),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."a" = $1 AND ("u"."b" = $2 OR "u"."c" = $3)',
    );
  });

  it('skips parens for a single-element parent group', () => {
    const g = group([
      step(
        'OR',
        group([
          step('AND', where('a', '=', 1, 'u')),
          step('OR', where('c', '=', 3, 'u')),
        ]),
      ),
    ]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."a" = $1 OR "u"."c" = $2',
    );
  });

  it('renders IS NULL without right-hand value (TG11)', () => {
    const g = group([step('AND', where('name', 'IS NULL', null, 'u'))]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."name" IS NULL',
    );
    expect(values).toEqual([]);
  });

  it('renders IS NOT NULL without right-hand value (TG11)', () => {
    const g = group([step('AND', where('age', 'IS NOT NULL', null, 'u'))]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereGroupSql'](g, values, p)).toBe(
      '"u"."age" IS NOT NULL',
    );
expect(values).toEqual([]);
  });

  it('throws on non-whitelisted operator (S5)', () => {
    const g = group([step('AND', where('name', 'DROP TABLE', 'x', 'u'))]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(() => gen['_buildWhereGroupSql'](g, values, p)).toThrow(
      /Unsupported operator: DROP TABLE/,
    );
  });

  it('uses column over field when column is set', () => {
    const g = group([
      step('AND', where('name', '=', 'Alice', 'u', 'display_name')),
    ]);
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
    const g = group([]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereClause'](g, values, p, [])).toBe('');
  });

  it('renders WHERE from conditions', () => {
    const g = group([step('AND', where('name', '=', 'Alice', 'u'))]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereClause'](g, values, p, [])).toBe(
      'WHERE "u"."name" = $1',
    );
  });

  it('appends extraConditions with AND', () => {
    const g = group([step('AND', where('name', '=', 'Alice', 'u'))]);
    const values: unknown[] = [];
    const p = { p: 1 };
    expect(gen['_buildWhereClause'](g, values, p, ['"u"."id" = t.id'])).toBe(
      'WHERE "u"."name" = $1 AND "u"."id" = t.id',
    );
  });
});
