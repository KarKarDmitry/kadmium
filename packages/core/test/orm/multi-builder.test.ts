import { describe, it, expect } from 'vitest';
import { MultiQueryBuilder } from '../../src/orm/builders/multi';
import { makeUserIR, makePostIR, makeMockAdapter, type MockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

function multiBuilder(adapter?: MockAdapter) {
  const irs = new Map([
    ['u', makeUserIR()],
    ['p', makePostIR()],
  ]);
  return new MultiQueryBuilder(irs, undefined, adapter as unknown as SqlAdapter);
}

describe('MultiQueryBuilder — constructor', () => {
  it('registers all aliases in tableContext', () => {
    const b = multiBuilder();
    expect(b.sqb.tableContext.get('u')).toBe('users');
    expect(b.sqb.tableContext.get('p')).toBe('posts');
  });
});

describe('MultiQueryBuilder — where', () => {
  it('pushes condition via MultiFilterProxy', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.where((t: any) => t.u.name.eq('Alice'));
    expect(b.sqb.wheres.conditions.length).toBe(1);
  });

  it('invalid alias throws', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => b.where((t: any) => t.x.name.eq('Alice'))).toThrow('Alias "x" not found');
  });

  it('invalid field throws', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => b.where((t: any) => t.u.nonexistent.eq('Alice'))).toThrow('Field "nonexistent" not found');
  });
});

describe('MultiQueryBuilder — join', () => {
  it('default direction is inner', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.join({ left: 'u', right: 'p', on: (t: any) => t.u.id.eq(t.p.author) });
    expect(b.sqb.joins.length).toBe(1);
    expect(b.sqb.joins[0].direction).toBe('inner');
  });

  it('custom direction is stored', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.join({ left: 'u', right: 'p', direction: 'left', on: (t: any) => t.u.id.eq(t.p.author) });
    expect(b.sqb.joins[0].direction).toBe('left');
  });
});

describe('MultiQueryBuilder — select', () => {
  it('returns toSql and go', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = b.select((t: any) => [t.u.name, t.p.title]);
    expect(typeof result.toSql).toBe('function');
    expect(typeof result.go).toBe('function');
  });

  it('go throws without adapter', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = b.select((t: any) => [t.u.name]);
    expect(() => result.go()).toThrow('No adapter configured');
  });

  it('select applies to a snapshot, not the builder', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.select((t: any) => [t.u.name]);
    expect(b.sqb.selects).toBeNull();
  });
});

describe('MultiQueryBuilder — clone', () => {
  it('returns an independent builder', () => {
    const b = multiBuilder();
    const c = b.clone();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.where((t: any) => t.u.name.eq('Alice'));
    c.limit(10);
    expect(b.sqb.wheres.conditions.length).toBe(0);
    expect(b.sqb.limit).toBeNull();
    expect(c.sqb.wheres.conditions.length).toBe(1);
    expect(c.sqb.limit).toBe(10);
  });

  it('copies state from the source', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.where((t: any) => t.u.name.eq('Alice'));
    b.include({ u: { posts: true } });
    const c = b.clone();
    expect(c.sqb.wheres.conditions.length).toBe(1);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.order((t: any) => t.u.name, 'desc');
    expect(b.sqb.orders.length).toBe(1);
    expect(b.sqb.orders[0].direction).toBe('desc');
  });

  it('groupBy', () => {
    const b = multiBuilder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.groupBy((t: any) => [t.u.name]);
    expect(b.sqb.groupBy).toContain('name');
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
