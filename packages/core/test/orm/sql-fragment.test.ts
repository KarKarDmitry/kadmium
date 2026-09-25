import { describe, expect, it } from 'vitest';
import {
  sql,
  SqlFragment,
  array,
  isSqlFragment,
  shiftSql,
} from '../../src/orm/sql-fragment';
import { slot } from '../../src/orm/slot';
import { SelectableField } from '../../src/orm/ast/selectable';
import type { CompiledQuery } from '@karkardmitry/kadmium-sql-types';

function makeCompiled(
  text: string,
  values: unknown[],
  slotOrder: { name: string; index: number }[],
): CompiledQuery {
  return {
    text,
    values: values as (
      unknown | import('@karkardmitry/kadmium-sql-types').HoleRef
    )[],
    slotOrder,
    single: false,
    sqb: {} as import('@karkardmitry/kadmium-sql-types').ReadonlySqb,
    _slots: {} as Record<string, never>,
  };
}

describe('sql tag — SqlFragment', () => {
  it('creates fragment from template literals', () => {
    const f = sql`SELECT 1`;
    expect(f).toBeInstanceOf(SqlFragment);
    expect(f.kind).toBe('sql');
    expect(f.segments).toEqual(['SELECT 1']);
    expect(f.parts).toEqual([]);
  });

  it('captures interpolated parts', () => {
    const f = sql`x = ${1} AND y = ${'hello'}`;
    expect(f.segments).toEqual(['x = ', ' AND y = ', '']);
    expect(f.parts).toEqual([1, 'hello']);
  });

  it('throws on undefined at any position', () => {
    expect(() => sql`x = ${undefined as never}`).toThrow(
      'undefined at position 0',
    );
    expect(() => sql`${1} = ${undefined as never}`).toThrow(
      'undefined at position 1',
    );
  });

  it('accepts null as a param', () => {
    const f = sql`x = ${null}`;
    expect(f.parts).toEqual([null]);
    const c = f.compile();
    expect(c.text).toBe('x = $1');
    expect(c.values).toEqual([null]);
  });
});

describe('sql — compile() rendering', () => {
  it('renders primitives as positional params', () => {
    const c = sql`x = ${1} AND y = ${'hello'}`.compile();
    expect(c.text).toBe('x = $1 AND y = $2');
    expect(c.values).toEqual([1, 'hello']);
    expect(c.slotOrder).toEqual([]);
  });

  it('renders Date as a param', () => {
    const d = new Date('2025-01-01');
    const c = sql`d = ${d}`.compile();
    expect(c.text).toBe('d = $1');
    expect(c.values).toEqual([d]);
  });

  it('renders boolean as a param', () => {
    const c = sql`flag = ${true}`.compile();
    expect(c.text).toBe('flag = $1');
    expect(c.values).toEqual([true]);
  });

  it('renders slot marker as named param', () => {
    const s = slot('tenantId');
    const c = sql`tenant = ${s}`.compile();
    expect(c.text).toBe('tenant = $1');
    expect(c.values).toContain(s);
    expect(c.slotOrder).toEqual([{ name: 'tenantId', index: 1 }]);
  });

  it('deduplicates slot markers by name', () => {
    const s = slot('x');
    const c = sql`${s} AND ${s} AND ${s}`.compile();
    expect(c.text).toBe('$1 AND $2 AND $3');
    expect(c.values).toHaveLength(3);
    expect(c.slotOrder).toEqual([{ name: 'x', index: 1 }]);
  });

  it('renders nested fragment inline with renumbered params', () => {
    const inner = sql`a = ${1}`;
    const outer = sql`x AND ${inner} AND y = ${2}`;
    const c = outer.compile();
    expect(c.text).toBe('x AND a = $1 AND y = $2');
    expect(c.values).toEqual([1, 2]);
  });

  it('renders array([...]) as a single parameter', () => {
    const c = sql`id = ANY(${array([1, 2, 3])})`.compile();
    expect(c.text).toBe('id = ANY($1)');
    expect(c.values).toEqual([[1, 2, 3]]);
    expect(c.slotOrder).toEqual([]);
  });

  it('renumbers nested fragment with offset', () => {
    const inner = sql`${slot('a')}`;
    const outer = sql`${1} AND ${inner} AND ${slot('b')}`;
    const c = outer.compile();
    expect(c.text).toBe('$1 AND $2 AND $3');
    expect(c.values).toHaveLength(3);
    expect(c.slotOrder).toEqual([
      { name: 'a', index: 2 },
      { name: 'b', index: 3 },
    ]);
  });

  it('deduplicates slot names across nested fragments', () => {
    const inner = sql`${slot('x')}`;
    const outer = sql`${slot('x')} AND ${inner}`;
    const c = outer.compile();
    expect(c.slotOrder).toEqual([{ name: 'x', index: 1 }]);
    expect(c.values).toHaveLength(2);
  });

  it('inlines compiled query with renumbering', () => {
    const inner = makeCompiled('SELECT $1', [42], []);
    const outer = sql`WITH t AS (${inner}) SELECT * FROM t`;
    const c = outer.compile();
    expect(c.text).toBe('WITH t AS (SELECT $1) SELECT * FROM t');
    expect(c.values).toEqual([42]);
  });

  it('merges slotOrder from inlined compiled query', () => {
    const inner = makeCompiled(
      'SELECT $1',
      [{ kind: 'slot' as const, slotName: 'a' }],
      [{ name: 'a', index: 1 }],
    );
    const outer = sql`WITH t AS (${inner}) SELECT ${slot('b')}`;
    const c = outer.compile();
    expect(c.slotOrder).toEqual([
      { name: 'a', index: 1 },
      { name: 'b', index: 2 },
    ]);
  });

  it('skips duplicate slot names from inlined compiled query', () => {
    const inner = makeCompiled(
      '$1',
      [{ kind: 'slot' as const, slotName: 'x' }],
      [{ name: 'x', index: 1 }],
    );
    const outer = sql`${slot('x')} AND ${inner}`;
    const c = outer.compile();
    expect(c.slotOrder).toEqual([{ name: 'x', index: 1 }]);
    expect(c.values).toHaveLength(2);
  });

  it('throws on nested undefined in fragment', () => {
    const inner = sql`a = ${1}`;
    expect(() => sql`${inner} AND ${undefined as never}`).toThrow(
      'undefined at position 1',
    );
  });
});

describe('sql — shiftSql', () => {
  it('shifts $N by offset', () => {
    expect(shiftSql('$1 AND $2', 3)).toBe('$4 AND $5');
  });

  it('returns original when offset is 0', () => {
    expect(shiftSql('$1', 0)).toBe('$1');
  });

  it('handles no params', () => {
    expect(shiftSql('SELECT 1', 5)).toBe('SELECT 1');
  });

  it('handles multi-digit params', () => {
    expect(shiftSql('$10 AND $11', 2)).toBe('$12 AND $13');
  });
});

describe('sql — toString (debug)', () => {
  it('inlines primitive values', () => {
    expect(sql`x = ${1}`.toString()).toBe('x = 1');
  });

  it('inlines strings', () => {
    expect(sql`name = ${'Alice'}`.toString()).toBe('name = Alice');
  });

  it('inlines null', () => {
    expect(sql`x = ${null}`.toString()).toBe('x = null');
  });

  it('renders nested fragment', () => {
    const inner = sql`${2}`;
    expect(sql`${inner} AND ${3}`.toString()).toBe('2 AND 3');
  });

  it('renders compiled query text + values inline', () => {
    const compiled = makeCompiled('SELECT $1', ['a', 'b'], []);
    expect(sql`CTE: (${compiled})`.toString()).toBe('CTE: (SELECT $1 [a, b])');
  });
});

describe('sql — .as()', () => {
  it('pre-renders SqlSelectable with alias and text', () => {
    const f = sql`EXTRACT(YEAR FROM now())`;
    const s = f.as('year');
    expect(s.kind).toBe('sql-item');
    expect(s.alias).toBe('year');
    expect(s.text).toBe('EXTRACT(YEAR FROM now())');
    expect(s.values).toEqual([]);
    expect(s.slotOrder).toEqual([]);
  });

  it('pre-renders params and slots into the selectable', () => {
    const s = slot('ids');
    const sel = sql`COALESCE(x, ${1}, ${s})`.as('c');
    expect(sel.text).toBe('COALESCE(x, $1, $2)');
    expect(sel.values).toEqual([1, s]);
    expect(sel.slotOrder).toEqual([{ name: 'ids', index: 2 }]);
  });
});

describe('sql — field refs', () => {
  it('inlines getIdentifierForSql() for field-like parts', () => {
    const f = sql`EXTRACT(YEAR FROM created_at)`;
    const sel = f.as('year');
    expect(sel.text).toBe('EXTRACT(YEAR FROM created_at)');
  });

  it('renders a SelectableField as an identifier', () => {
    const field = {
      getIdentifierForSql: () => '"u"."created_at"',
    };
    const c = sql`EXTRACT(YEAR FROM ${field})`.compile();
    expect(c.text).toBe('EXTRACT(YEAR FROM "u"."created_at")');
    expect(c.values).toEqual([]);
  });

  it('renders a field ref via toString', () => {
    const field = {
      getIdentifierForSql: () => '"p"."views"',
    };
    expect(sql`${field} + 1`.toString()).toBe('"p"."views" + 1');
  });

  it('renders a SelectableField via getIdentifierForSql()', () => {
    const u = new SelectableField('u', 'created_at');
    const c = sql`EXTRACT(YEAR FROM ${u})`.compile();
    expect(c.text).toBe('EXTRACT(YEAR FROM "u"."created_at")');
    expect(c.values).toEqual([]);
  });
});

describe('sql — .asc / .desc', () => {
  it('returns SqlOrder with direction', () => {
    const f = sql`similarity(name, 'x')`;
    expect(f.asc.direction).toBe('asc');
    expect(f.asc.fragment).toBe(f);
    expect(f.desc.direction).toBe('desc');
    expect(f.desc.fragment).toBe(f);
  });
});

describe('isSqlFragment', () => {
  it('returns true for SqlFragment', () => {
    expect(isSqlFragment(sql`SELECT 1`)).toBe(true);
  });

  it('returns false for non-fragments', () => {
    expect(isSqlFragment(null)).toBe(false);
    expect(isSqlFragment(42)).toBe(false);
    expect(isSqlFragment({ kind: 'selectable' })).toBe(false);
  });
});
