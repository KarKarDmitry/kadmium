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
    b.order((t: any) => t.name, 'desc');
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
    expect(adapter.execute).toHaveBeenCalledWith(expect.objectContaining({ operation: 'upsert', upsertData: { name: 'Alice' } }));
  });
});

describe('SingleQueryBuilder — update', () => {
  it('sets operation to update', () => {
    const b = builder();
    b.update({ name: 'Alice' });
    expect(b.sqb.operation).toBe('update');
  });

  it('maps aliases to updateData', () => {
    const b = builder();
    b.update({ name: 'Alice' });
    expect(b.sqb.updateData).toEqual({ name: 'Alice' });
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

  it('finalizer where pushes condition', () => {
    const b = builder();
    const f = b.update({ name: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.where((u: any) => u.id.eq(1));
    expect(b.sqb.wheres.conditions.length).toBe(1);
  });
});

describe('SingleQueryBuilder — delete', () => {
  it('sets operation to delete', () => {
    const b = builder();
    b.delete();
    expect(b.sqb.operation).toBe('delete');
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

  it('returning sets sqb.selects', () => {
    const b = builder();
    const f = b.update({ name: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.returning((u: any) => [u.id]);
    expect(b.sqb.selects).not.toBeNull();
    expect(b.sqb.selects!.length).toBe(1);
  });

  it('returning with aggregate sets select list', () => {
    const b = builder();
    const f = b.update({ name: 'Alice' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.returning((u: any, a: any) => [u.id, a.count('*').as('total')]);
    expect(b.sqb.selects!.length).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((b.sqb.selects![1] as any).kind).toBe('aggregate');
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
    expect(b.sqb.wheres.conditions.length).toBe(1);
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

  it('returning sets sqb.selects', () => {
    const b = builder();
    const f = b.delete();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.returning((u: any) => [u.id]);
    expect(b.sqb.selects).not.toBeNull();
    expect(b.sqb.selects!.length).toBe(1);
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

  it('auto-selects fields when select() not called', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = builder(adapter);
    await b.go();
    expect(b.sqb.selects).not.toBeNull();
  });
});
