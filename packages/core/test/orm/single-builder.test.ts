import { describe, it, expect } from 'vitest';
import { SingleQueryBuilder } from '../../src/orm/builders/single';
import { makeUserIR, makeMockAdapter, type MockAdapter } from './helpers';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';

function builder(adapter?: MockAdapter) {
  return new SingleQueryBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('SingleQueryBuilder — constructor', () => {
  it('sets tableContext', () => {
    const b = builder();
    expect(b.sqb.tableContext.get('User')).toBe('users');
  });
});

describe('SingleQueryBuilder — where/and/or', () => {
  it('where pushes condition', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.where((u: any) => u.name.eq('Alice'));
    expect(b.sqb.wheres.conditions.length).toBe(1);
  });

  it('and is alias for where', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.and((u: any) => u.name.eq('Alice'));
    expect(b.sqb.wheres.conditions.length).toBe(1);
  });

  it('or uses addOrCondition', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.where((u: any) => u.name.eq('Alice'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.or((u: any) => u.name.eq('Bob'));
    expect(b.sqb.wheres.op).toBe('OR');
  });
});

describe('SingleQueryBuilder — group', () => {
  it('empty callback does not push group', () => {
    const b = builder();
    b.group(() => {});
    expect(b.sqb.wheres.conditions.length).toBe(0);
  });

  it('with conditions pushes group', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.group((q: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      q.where((u: any) => u.name.eq('Alice'));
    });
    expect(b.sqb.wheres.conditions.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const group = b.sqb.wheres.conditions[0] as any;
    expect(group.op).toBe('AND');
    expect(group.conditions).toBeDefined();
  });

  it('restores wheres even on exception', () => {
    const b = builder();
    const original = b.sqb.wheres;
    try {
      b.group(() => {
        throw new Error('test');
      });
    } catch {
      /* expected */
    }
    expect(b.sqb.wheres).toBe(original);
  });
});

describe('SingleQueryBuilder — select', () => {
  it('no-arg selects all non-sourceModel fields', () => {
    const b = builder();
    b.select();
    expect(b.sqb.selects).not.toBeNull();
    // User has: id, name, email, age, active, posts(sourceModel) → 5 fields
    expect(b.sqb.selects!.length).toBe(5);
  });

  it('with selector passes aggregates', () => {
    const b = builder();
    b.select((t, _agg) => [t.name]);
    expect(b.sqb.selects).not.toBeNull();
    expect(b.sqb.selects!.length).toBe(1);
  });
});

describe('SingleQueryBuilder — first', () => {
  it('sets limit=1', () => {
    const b = builder();
    b.first();
    expect(b.sqb.limit).toBe(1);
  });
});

describe('SingleQueryBuilder — modifiers', () => {
  it('groupBy pushes to sqb.groupBy', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.groupBy((t: any) => [t.name]);
    expect(b.sqb.groupBy).toContain('name');
  });

  it('order pushes to sqb.orders', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.order((t: any) => [t.name.desc]);
    expect(b.sqb.orders.length).toBe(1);
    expect(b.sqb.orders[0].direction).toBe('desc');
  });

  it('limit sets sqb.limit', () => {
    const b = builder();
    b.limit(10);
    expect(b.sqb.limit).toBe(10);
  });

  it('offset sets sqb.offset', () => {
    const b = builder();
    b.offset(5);
    expect(b.sqb.offset).toBe(5);
  });

  it('page sets limit+offset', () => {
    const b = builder();
    b.page(2, 10);
    expect(b.sqb.limit).toBe(10);
    expect(b.sqb.offset).toBe(10);
  });

  it('page(0, 10) clamps page to 1', () => {
    const b = builder();
    b.page(0, 10);
    expect(b.sqb.offset).toBe(0);
  });

  it('page(1, 0) clamps size to 1', () => {
    const b = builder();
    b.page(1, 0);
    expect(b.sqb.limit).toBe(1);
  });
});

describe('SingleQueryBuilder — having', () => {
  it('pushes aggregate-alias condition to sqb.havings', () => {
    const b = builder();
    b.select((t: any, a: any) => [t.id, a.count('*').as('total')]);
    b.having((t: any) => t.total.gt(5));
    expect(b.sqb.havings.conditions.length).toBe(1);
    const c = b.sqb.havings.conditions[0] as {
      field: string;
      op: string;
      alias?: string;
    };
    expect(c.field).toBe('total');
    expect(c.op).toBe('>');
    expect(c.alias).toBe('');
  });

  it('throws on unknown aggregate alias with .as() hint', () => {
    const b = builder();
    b.select((t: any) => [t.id]);
    expect(() => b.having((t: any) => t.total.gt(1))).toThrow(
      'Unknown aggregate alias',
    );
    expect(() => b.having((t: any) => t.total.gt(1))).toThrow(/\.as\("/);
  });

  it('clone() copies havings', () => {
    const b = builder();
    b.select((t: any, a: any) => [t.id, a.count('*').as('total')]);
    b.having((t: any) => t.total.gt(5));
    const c = b.clone();
    expect(c.sqb.havings.conditions.length).toBe(1);
  });

  it('havingOr flips the having group to OR', () => {
    const b = builder();
    b.select((t: any, a: any) => [t.id, a.count('*').as('total')]);
    b.having((t: any) => t.total.gt(5));
    b.havingOr((t: any) => t.total.lt(1));
    expect(b.sqb.havings.op).toBe('OR');
    expect(b.sqb.havings.conditions.length).toBe(2);
  });

  it('havingGroup pushes a nested group (parentheses)', () => {
    const b = builder();
    b.select((t: any, a: any) => [t.id, a.count('*').as('total')]);
    b.havingGroup((q) => {
      q.having((t: any) => t.total.gt(5));
      q.havingOr((t: any) => t.total.lt(1));
    });
    expect(b.sqb.havings.conditions.length).toBe(1);
    const child = b.sqb.havings.conditions[0] as {
      op: string;
      conditions: unknown[];
    };
    expect(child.op).toBe('OR');
    expect(child.conditions.length).toBe(2);
  });

  it('havingGroup empty callback pushes nothing', () => {
    const b = builder();
    b.select((t: any, a: any) => [t.id, a.count('*').as('total')]);
    b.havingGroup(() => {});
    expect(b.sqb.havings.conditions.length).toBe(0);
  });
});

describe('SingleQueryBuilder — findById', () => {
  it('throws when no PK', () => {
    const ir = {
      name: 'X',
      collection: 'x',
      fields: {
        name: {
          type: 'string' as const,
          alias: 'name',
          tsType: 'string',
          nullable: false,
          unique: false,
          index: false,
        },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = new SingleQueryBuilder(ir as any);
    expect(() => b.findById(1)).toThrow('No primary key field found');
  });

  it('adds where on PK and calls first', () => {
    const b = builder();
    b.findById(42);
    expect(b.sqb.limit).toBe(1);
    expect(b.sqb.wheres.conditions.length).toBe(1);
  });
});

describe('SingleQueryBuilder — create', () => {
  it('throws without adapter', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => b.create({ name: 'Alice' } as any)).toThrow(
      'No adapter configured',
    );
  });

  it('maps aliases and calls adapter.execute', async () => {
    const adapter = makeMockAdapter();
    const b = builder(adapter);
    await b.create({ name: 'Alice' }).go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'upsert',
        upsertData: { name: 'Alice' },
      }),
    );
  });
});

describe('SingleQueryBuilder — update', () => {
  it('does not mutate the builder (works on a snapshot)', () => {
    const b = builder();
    b.update({ name: 'Alice' });
    expect(b.sqb.operation).toBe('select');
    expect(b.sqb.updateData).toBeNull();
  });

  it('finalizer has where/go/sql', () => {
    const b = builder();
    const f = b.update({ name: 'Alice' });
    expect(typeof f.where).toBe('function');
    expect(typeof f.go).toBe('function');
    expect(typeof f.sql).toBe('function');
  });

  it('finalizer go throws without adapter', async () => {
    const b = builder();
    const f = b.update({ name: 'Alice' });
    await expect(f.go()).rejects.toThrow('No adapter configured');
  });

  it('finalizer where applies to snapshot, not builder', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = builder(adapter);
    const f = b.update({ name: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.where((u: any) => u.id.eq(1));
    expect(b.sqb.wheres.conditions.length).toBe(0);
    await f.go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'update',
        wheres: expect.objectContaining({
          conditions: expect.arrayContaining([expect.anything()]),
        }),
      }),
    );
  });
});

describe('SingleQueryBuilder — delete', () => {
  it('does not mutate the builder (works on a snapshot)', () => {
    const b = builder();
    b.delete();
    expect(b.sqb.operation).toBe('select');
  });

  it('finalizer has where/go/sql', () => {
    const b = builder();
    const f = b.delete();
    expect(typeof f.where).toBe('function');
    expect(typeof f.go).toBe('function');
    expect(typeof f.sql).toBe('function');
  });
});

describe('SingleQueryBuilder — update returning', () => {
  it('finalizer has returning directly and after where', () => {
    const f = builder().update({ name: 'Alice' });
    expect(typeof f.returning).toBe('function');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof f.where((u: any) => u.id.eq(1)).returning).toBe('function');
  });

  it('returning applies to snapshot, not builder', () => {
    const b = builder();
    const f = b.update({ name: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.returning((u: any) => [u.id]);
    expect(b.sqb.selects).toBeNull();
  });

  it('returning with aggregate is executed with aggregate select', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1, total: 2 }]);
    const b = builder(adapter);
    const f = b.update({ name: 'Alice' });
    await f
      .returning((u: any, a: any) => [u.id, a.count('*').as('total')])
      .go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        selects: expect.arrayContaining([
          expect.objectContaining({ kind: 'aggregate' }),
        ]),
      }),
    );
  });

  it('returning go throws without adapter', async () => {
    const f = builder().update({ name: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(f.returning((u: any) => [u.id]).go()).rejects.toThrow(
      'No adapter configured',
    );
  });

  it('returning go maps rows by alias', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ n: 'Alice' }]);
    const b = builder(adapter);
    const f = b.update({ name: 'new' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await f.returning((u: any) => [u.name.as('n')]).go();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'update' }),
    );
    expect(result).toEqual([{ n: 'Alice' }]);
  });

  it('returning go drops unselected fields', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1, name: 'Alice' }]);
    const b = builder(adapter);
    const f = b.update({ name: 'new' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await f.returning((u: any) => [u.id]).go();
    expect(result).toEqual([{ id: 1 }]);
    expect('name' in result[0]).toBe(false);
  });

  it('where().returning().go() applies where and maps rows', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 42 }]);
    const b = builder(adapter);
    const f = b.update({ name: 'new' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await f
      .where((u: any) => u.id.eq(1))
      .returning((u: any) => [u.id])
      .go();
    expect(b.sqb.wheres.conditions.length).toBe(0);
    expect(result).toEqual([{ id: 42 }]);
  });
});

describe('SingleQueryBuilder — delete returning', () => {
  it('finalizer has returning directly and after where', () => {
    const f = builder().delete();
    expect(typeof f.returning).toBe('function');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof f.where((u: any) => u.id.eq(1)).returning).toBe('function');
  });

  it('returning applies to snapshot, not builder', () => {
    const b = builder();
    const f = b.delete();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.returning((u: any) => [u.id]);
    expect(b.sqb.selects).toBeNull();
  });

  it('returning go maps rows and drops unselected', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 7, name: 'Ghost' }]);
    const b = builder(adapter);
    const f = b.delete();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await f.returning((u: any) => [u.id]).go();
    expect(result).toEqual([{ id: 7 }]);
  });
});

describe('SingleQueryBuilder — count', () => {
  it('returns number via go()', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ count: '5' }]);
    const b = builder(adapter);
    const result = await b.count().go();
    expect(result).toBe(5);
  });

  it('returns 0 when no rows', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = builder(adapter);
    const result = await b.count().go();
    expect(result).toBe(0);
  });
});

describe('SingleQueryBuilder — exists', () => {
  it('returns true when rows exist', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1 }]);
    const b = builder(adapter);
    const result = await b.exists().go();
    expect(result).toBe(true);
  });

  it('returns false when no rows', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = builder(adapter);
    const result = await b.exists().go();
    expect(result).toBe(false);
  });
});

describe('SingleQueryBuilder — toSql', () => {
  it('throws without adapter', () => {
    const b = builder();
    expect(() => b.toSql()).toThrow('No adapter configured');
  });

  it('returns formatted string', () => {
    const adapter = makeMockAdapter();
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    const b = builder(adapter);
    expect(b.toSql()).toBe('SQL: SELECT 1\nVALUES: []');
  });
});

describe('SingleQueryBuilder — go', () => {
  it('throws without adapter', async () => {
    const b = builder();
    await expect(b.go()).rejects.toThrow('No adapter configured');
  });

  it('auto-selects fields into a snapshot, not the builder', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = builder(adapter);
    await b.go();
    expect(b.sqb.selects).toBeNull();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ selects: expect.any(Array) }),
    );
  });
});

describe('SingleQueryBuilder — clone', () => {
  it('returns an independent builder', () => {
    const b = builder();
    const c = b.clone();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.where((u: any) => u.name.eq('Alice'));
    c.limit(10);
    expect(b.sqb.wheres.conditions.length).toBe(0);
    expect(b.sqb.limit).toBeNull();
    expect(c.sqb.wheres.conditions.length).toBe(1);
    expect(c.sqb.limit).toBe(10);
  });

  it('copies state from the source', () => {
    const b = builder();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.where((u: any) => u.name.eq('Alice'));
    b.first();
    const c = b.clone();
    expect(c.sqb.wheres.conditions.length).toBe(1);
    expect(c.sqb.limit).toBe(1);
  });

  it('deep-copies aggregate selects', () => {
    const b = builder();
    b.select((t: any, a: any) => [a.count('*').as('total')]);
    const c = b.clone();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c.sqb.selects![0] as any).as('renamed');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((b.sqb.selects![0] as any).alias).toBe('total');
  });

  it('go() twice produces identical snapshots', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = builder(adapter);
    await b.go();
    await b.go();
    const [first, second] = adapter.execute.mock.calls;
    expect(first![0].selects).toEqual(second![0].selects);
    expect(b.sqb.selects).toBeNull();
  });
});
