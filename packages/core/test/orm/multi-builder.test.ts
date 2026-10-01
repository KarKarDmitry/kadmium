import { describe, it, expect } from 'vitest';
import { MultiQueryBuilder } from '../../src/orm/builders/query';
import { or } from '../../src/orm/where-expression';
import { sql } from '../../src/orm/sql-fragment';
import {
  makeUserIR,
  makePostIR,
  makeMockAdapter,
  type MockAdapter,
} from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

function multiBuilder(adapter?: MockAdapter) {
  const irs = new Map([
    ['u', makeUserIR()],
    ['p', makePostIR()],
  ]);
  return new MultiQueryBuilder(
    irs,
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('MultiQueryBuilder — constructor', () => {
  it('registers all aliases in tableContext', () => {
    const b = multiBuilder();
    expect(b.sqb.tableContext.get('u')).toBe('users');
    expect(b.sqb.tableContext.get('p')).toBe('posts');
  });

  it('marks sqb as multi (isMulti=true)', () => {
    const b = multiBuilder();
    expect(b.sqb.isMulti).toBe(true);
  });
});

describe('MultiQueryBuilder — where', () => {
  it('pushes condition via MultiFilterProxy', () => {
    const b = multiBuilder();

    b.where((t: any) => t.u.name.eq('Alice'));
    expect(b.sqb.wheres.elements.length).toBe(1);
  });

  it('invalid alias throws', () => {
    const b = multiBuilder();

    expect(() => b.where((t: any) => t.x.name.eq('Alice'))).toThrow(
      'Alias "x" not found',
    );
  });

  it('invalid field throws', () => {
    const b = multiBuilder();

    expect(() => b.where((t: any) => t.u.nonexistent.eq('Alice'))).toThrow(
      'Field "nonexistent" not found',
    );
  });
});

describe('MultiQueryBuilder — join', () => {
  it('default direction is inner', () => {
    const b = multiBuilder();

    b.join({ left: 'u', right: 'p', on: (t: any) => t.u.id.eq(t.p.author) });
    expect(b.sqb.joins.length).toBe(1);
    expect(b.sqb.joins[0].direction).toBe('inner');
  });

  it('custom direction is stored', () => {
    const b = multiBuilder();

    b.join({
      left: 'u',
      right: 'p',
      direction: 'left',
      on: (t: any) => t.u.id.eq(t.p.author),
    });
    expect(b.sqb.joins[0].direction).toBe('left');
  });

  it('throws on a duplicate join of the same pair and direction (C11)', () => {
    const b = multiBuilder();

    b.join({ left: 'u', right: 'p', on: (t: any) => t.u.id.eq(t.p.author) });

    expect(() =>
      b.join({ left: 'u', right: 'p', on: (t: any) => t.u.name.eq(t.p.title) }),
    ).toThrow(/join\(\) on u ↔ p \(inner\) is already declared/);
    // AST не изменился: второе условие не добавилось и не заменило первое
    expect(b.sqb.joins.length).toBe(1);
    expect(b.sqb.joins[0].on).toMatchObject({ field: 'id' });
  });

  it('allows the same pair with a different direction (C11)', () => {
    const b = multiBuilder();

    b.join({
      left: 'u',
      right: 'p',
      direction: 'left',
      on: (t: any) => t.u.id.eq(t.p.author),
    });

    b.join({ left: 'u', right: 'p', on: (t: any) => t.u.id.eq(t.p.author) });
    expect(b.sqb.joins.length).toBe(2);
  });

  it('accepts a sql-fragment as join.on (precompiled to SqlCondition)', () => {
    const b = multiBuilder();

    b.join({
      left: 'u',
      right: 'p',
      on: (t: any) => sql`${t.u.id} = ${t.p.author}`,
    });
    expect(b.sqb.joins[0].on).toMatchObject({ kind: 'sql-condition' });
  });

  it('accepts a group expression as join.on', () => {
    const b = multiBuilder();

    b.join({
      left: 'u',
      right: 'p',
      on: (t: any) => or(t.u.id.eq(t.p.author), t.u.active.eq(t.p.title)),
    });
    expect(b.sqb.joins[0].on).toHaveProperty('elements');
  });
});

describe('MultiQueryBuilder — select', () => {
  it('returns toSql and go', () => {
    const b = multiBuilder();

    const result = b.fields((t: any) => [t.u.name, t.p.title]);
    expect(typeof result.toSql).toBe('function');
    expect(typeof result.go).toBe('function');
  });

  it('go throws without adapter', () => {
    const b = multiBuilder();

    const result = b.fields((t: any) => [t.u.name]);
    expect(() => result.go()).toThrow('No adapter configured');
  });

  it('select applies to a snapshot, not the builder', () => {
    const b = multiBuilder();

    b.fields((t: any) => [t.u.name]);
    expect(b.sqb.selects).toBeNull();
  });
});

describe('MultiQueryBuilder — clone', () => {
  it('returns an independent builder', () => {
    const b = multiBuilder();
    const c = b.clone();

    c.where((t: any) => t.u.name.eq('Alice'));
    c.limit(10);
    expect(b.sqb.wheres.elements.length).toBe(0);
    expect(b.sqb.limit).toBeNull();
    expect(c.sqb.wheres.elements.length).toBe(1);
    expect(c.sqb.limit).toBe(10);
  });

  it('copies state from the source', () => {
    const b = multiBuilder();

    b.where((t: any) => t.u.name.eq('Alice'));
    b.include({ u: { posts: true } });
    const c = b.clone();
    expect(c.sqb.wheres.elements.length).toBe(1);
    expect(c.sqb.includes.length).toBe(1);
  });
});

describe('MultiQueryBuilder — include', () => {
  it('pushes builder into sqb.includes', () => {
    const b = multiBuilder();
    b.include({ u: { posts: true } });
    expect(b.sqb.includes.length).toBe(1);
  });
});

describe('MultiQueryBuilder — modifiers', () => {
  it('limit', () => {
    const b = multiBuilder();
    b.limit(10);
    expect(b.sqb.limit).toBe(10);
  });

  it('offset', () => {
    const b = multiBuilder();
    b.offset(5);
    expect(b.sqb.offset).toBe(5);
  });

  it('order', () => {
    const b = multiBuilder();

    b.order((t: any) => [t.u.name.desc]);
    expect(b.sqb.orders.length).toBe(1);
    expect(b.sqb.orders[0].direction).toBe('desc');
  });

  it('groupBy', () => {
    const b = multiBuilder();

    b.groupBy((t: any) => [t.u.name]);
    expect(b.sqb.groupBy[0]).toMatchObject({
      kind: 'group-by-column',
      column: 'name',
      tableAlias: 'u',
    });
  });
});

describe('MultiQueryBuilder — count/exists/first', () => {
  it('count() returns number and resets limit/offset (S2)', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ count: '7' }]);
    const b = multiBuilder(adapter).limit(10).offset(5);
    const result = await b.count().go();
    expect(result).toBe(7);
    const sqb: any = adapter.execute.mock.calls[0][0];
    expect(sqb.limit).toBeNull();
    expect(sqb.offset).toBeNull();
  });

  it('count() overrides selects with COUNT(*)', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ count: '2' }]);
    const b = multiBuilder(adapter);
    await b.count().go();
    const sqb: any = adapter.execute.mock.calls[0][0];
    expect(sqb.selects).toHaveLength(1);
    expect(sqb.selects[0].kind).toBe('aggregate');
    expect(sqb.selects[0].func).toBe('count');
    expect(sqb.selects[0].field).toBe('*');
    expect(sqb.selects[0].alias).toBe('count');
  });

  it('exists() materializes default select (all tables) with LIMIT 1 and no offset', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1 }]);
    const b = multiBuilder(adapter).offset(5);
    const yes = await b.exists().go();
    expect(yes).toBe(true);
    const sqb: any = adapter.execute.mock.calls[0][0];
    expect(sqb.limit).toBe(1);
    expect(sqb.offset).toBeNull();
    const cols = sqb.selects
      .map((s: any) => `${s.tableAlias}.${s.column}`)
      .sort();
    expect(cols).toEqual([
      'p.author',
      'p.id',
      'p.title',
      'u.active',
      'u.age',
      'u.email',
      'u.id',
      'u.name',
    ]);
  });

  it('first() applies select on a snapshot, LIMIT 1, and unwraps rows[0]', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ name: 'Alice' }, { name: 'Bob' }]);
    const b = multiBuilder(adapter);
    const row = await b.first((t: any) => [t.u.name]).go();
    expect(row).toEqual({ name: 'Alice' });
    const sqb: any = adapter.execute.mock.calls[0][0];
    expect(sqb.limit).toBe(1);
    expect(b.sqb.selects).toBeNull();
  });

  it('first() returns undefined when no rows', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = multiBuilder(adapter);
    const row = await b.first((t: any) => [t.u.name]).go();
    expect(row).toBeUndefined();
  });

  it('first().compile() marks the query as single (unwrap)', async () => {
    const adapter = makeMockAdapter();
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    const b = multiBuilder(adapter);
    const c = b.first((t: any) => [t.u.name]).compile();
    expect(c.single).toBe(true);
    expect(c.text).toBe('SELECT 1');
  });
});

describe('MultiQueryBuilder — toSql', () => {
  it('throws without adapter', () => {
    const b = multiBuilder();
    expect(() => b.toSql()).toThrow('No adapter configured');
  });

  it('returns formatted string with adapter', () => {
    const adapter = makeMockAdapter();
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    const b = multiBuilder(adapter);
    expect(b.toSql()).toBe('SQL: SELECT 1\nVALUES: []');
  });
});
