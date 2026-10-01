import { describe, it, expect } from 'vitest';
import { SelectQueryBuilder } from '../../src/orm/builders/select';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../src/ir/index';
import { makeUserIR, makeMockAdapter, type MockAdapter } from './helpers';
import { and, or } from '../../src/orm/where-expression';
import { sql } from '../../src/orm/sql-fragment';

/**
 * Модель с нестандартными именами: PK — `uid`, колонка `display_name`.
 * `findById()` обязан опираться на `isPrimary`, а не на имя `id`.
 */
const ACCOUNT_IR: ModelIR = {
  name: 'Account',
  collection: 'accounts',
  fields: {
    uid: {
      type: 'bigint',
      alias: 'uid',
      tsType: 'number',
      nullable: false,
      unique: true,
      index: false,
      isPrimary: true,
    },
    handle: {
      type: 'string',
      alias: 'display_name',
      tsType: 'string',
      nullable: false,
      unique: false,
      index: false,
    },
    bio: {
      type: 'string',
      alias: 'bio',
      tsType: 'string',
      nullable: true,
      unique: false,
      index: false,
    },
  },
};

const NO_PK_IR: ModelIR = {
  name: 'Session',
  collection: 'sessions',
  fields: {
    token: {
      type: 'string',
      alias: 'token',
      tsType: 'string',
      nullable: false,
      unique: true,
      index: false,
    },
  },
};

/**
 * Тип модели для билдера: без него `~shape` деградирует до `unknown`, и
 * фильтры теряют `eq`/`.asc()` — тест проверял бы не то.
 */
interface Account {
  ['~shape']: {
    uid: number;
    handle: string;
    bio: string | undefined;
  };
  ['~rel']: Record<string, never>;
  ['~relInfo']: Record<string, never>;
}

function builder(adapter?: MockAdapter) {
  return new SelectQueryBuilder<Account>(
    ACCOUNT_IR,
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

/** Тесты поведения билдера — на общем User IR: поля, агрегаты, алиасы. */
function userBuilder(adapter?: MockAdapter) {
  return new SelectQueryBuilder(
    makeUserIR(),
    undefined,
    adapter as unknown as SqlAdapter,
  );
}

describe('SelectQueryBuilder — findById', () => {
  it('кидает No primary key field found, если isPrimary не задан', () => {
    const b = new SelectQueryBuilder<Account>(NO_PK_IR);
    expect(() => b.findById(1)).toThrow('No primary key field found');
  });

  it('фильтрует по PK и переходит в first: limit=1 и один элемент wheres', () => {
    const b = builder();
    b.findById(42);
    expect(b.sqb.limit).toBe(1);
    expect(b.sqb.wheres.elements).toHaveLength(1);
  });

  it('PK находится по isPrimary, а не по имени — колонка uid, не id', () => {
    const b = builder();
    b.findById(42);
    expect(b.sqb.wheres.elements[0]).toEqual({
      join: 'AND',
      condition: {
        alias: 'Account',
        field: 'uid',
        column: 'uid',
        op: '=',
        value: 42,
      },
    });
  });

  it('ссылка квалифицируется АЛИАСОМ колонки, а не именем поля', () => {
    // `handle` → `display_name`: findById по PK этого не касается, но
    // регрессия на алиасах здесь же и ловится — фильтр строится тем же proxy.
    const b = builder();
    b.where((a) => a.handle.eq('bob'));
    expect(b.sqb.wheres.elements[0]).toEqual({
      join: 'AND',
      condition: {
        alias: 'Account',
        field: 'handle',
        column: 'display_name',
        op: '=',
        value: 'bob',
      },
    });
  });

  it('go() в first-режиме возвращает одну запись, а не массив', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([{ uid: 42, handle: 'bob' }]);

    const found = await builder(adapter).findById(42).go();

    expect(found).toEqual({ uid: 42, handle: 'bob' });
    expect(Array.isArray(found)).toBe(false);
  });

  it('не найденная запись даёт undefined, а не []', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValueOnce([]);

    const found = await builder(adapter).findById(999).go();

    expect(found).toBeUndefined();
  });

  it('сохраняет уже набранные условия — findById добавляет AND, а не затирает', () => {
    const b = builder();
    b.where((a) => a.bio.eq('x'));
    b.findById(42);
    expect(b.sqb.wheres.elements).toHaveLength(2);
  });

  it('clone() не делит условия с оригиналом', () => {
    const b = builder();
    const c = b.clone();
    c.findById(42);
    expect(b.sqb.wheres.elements).toHaveLength(0);
    expect(c.sqb.wheres.elements).toHaveLength(1);
  });
});

describe('SelectQueryBuilder — constructor', () => {
  it('sets tableContext', () => {
    const b = userBuilder();
    expect(b.sqb.tableContext.get('User')).toBe('users');
  });
});

describe('SelectQueryBuilder — where/and/or', () => {
  it('where pushes condition', () => {
    const b = userBuilder();
    b.where((u: any) => u.name.eq('Alice'));
    expect(b.sqb.wheres.elements.length).toBe(1);
  });

  it('and is alias for where', () => {
    const b = userBuilder();
    b.and((u: any) => u.name.eq('Alice'));
    expect(b.sqb.wheres.elements.length).toBe(1);
  });

  it('or appends an OR step (no auto-grouping)', () => {
    const b = userBuilder();
    b.where((u: any) => u.name.eq('Alice'));
    b.or((u: any) => u.name.eq('Bob'));
    expect(b.sqb.wheres.elements.length).toBe(2);
    expect((b.sqb.wheres.elements[1] as any).join).toBe('OR');
  });

  it('where accepts and/or expressions as one step', () => {
    const b = userBuilder();
    b.where((u: any) =>
      or(u.name.eq('Alice'), and(u.name.eq('Bob'), u.active.eq(true))),
    );
    expect(b.sqb.wheres.elements.length).toBe(1);
    const group = (b.sqb.wheres.elements[0] as any).condition as {
      elements: unknown[];
    };
    expect(group.elements.length).toBe(2);
  });

  it('skips undefined expressions (and() with all-empty args)', () => {
    const b = userBuilder();
    b.where((u: any) => and(u.name.eq('Alice'), undefined));
    expect(b.sqb.wheres.elements.length).toBe(1);
    b.where(() => undefined as any);
    expect(b.sqb.wheres.elements.length).toBe(1);
  });
});

describe('SelectQueryBuilder — select', () => {
  it('fields() без аргумента выбирает все поля, кроме sourceModel', () => {
    const b = userBuilder();
    b.fields();
    expect(b.sqb.selects).not.toBeNull();
    // User has: id, name, email, age, active, posts(sourceModel) → 5 fields
    expect(b.sqb.selects!.length).toBe(5);
  });

  it('with selector passes aggregates', () => {
    const b = userBuilder();
    b.fields((t, _agg) => [t.name]);
    expect(b.sqb.selects).not.toBeNull();
    expect(b.sqb.selects!.length).toBe(1);
  });
});

describe('SelectQueryBuilder — first', () => {
  it('sets limit=1', () => {
    const b = userBuilder();
    b.first();
    expect(b.sqb.limit).toBe(1);
  });
});

describe('SelectQueryBuilder — modifiers', () => {
  it('groupBy pushes to sqb.groupBy', () => {
    const b = userBuilder();
    b.groupBy((t: any) => [t.name]);
    expect(b.sqb.groupBy[0]).toMatchObject({
      kind: 'group-by-column',
      column: 'name',
    });
  });

  it('groupBy accepts a sql-fragment step', () => {
    const b = userBuilder();
    b.groupBy((t: any) => [sql`lower(${t.name})`]);
    expect(b.sqb.groupBy[0]).toMatchObject({ kind: 'group-by-fragment' });
  });

  it('order pushes to sqb.orders', () => {
    const b = userBuilder();
    b.order((t: any) => [t.name.desc]);
    expect(b.sqb.orders.length).toBe(1);
    expect(b.sqb.orders[0].direction).toBe('desc');
  });

  it('limit sets sqb.limit', () => {
    const b = userBuilder();
    b.limit(10);
    expect(b.sqb.limit).toBe(10);
  });

  it('offset sets sqb.offset', () => {
    const b = userBuilder();
    b.offset(5);
    expect(b.sqb.offset).toBe(5);
  });

  it('page sets limit+offset', () => {
    const b = userBuilder();
    b.page(2, 10);
    expect(b.sqb.limit).toBe(10);
    expect(b.sqb.offset).toBe(10);
  });

  it('page(0, 10) clamps page to 1', () => {
    const b = userBuilder();
    b.page(0, 10);
    expect(b.sqb.offset).toBe(0);
  });

  it('page(1, 0) clamps size to 1', () => {
    const b = userBuilder();
    b.page(1, 0);
    expect(b.sqb.limit).toBe(1);
  });
});

describe('SelectQueryBuilder — cursor', () => {
  it('pushes expression to sqb.cursor', () => {
    const b = userBuilder();
    b.order((u: any) => [u.id.asc]);
    b.cursor((u: any) => u.id.gt(42));
    expect(b.sqb.cursor.elements.length).toBe(1);
    expect(b.sqb.wheres.elements.length).toBe(0);
    expect((b.sqb.cursor.elements[0] as any).condition).toMatchObject({
      field: 'id',
      column: 'id',
      op: '>',
      value: 42,
    });
  });

  it('accepts and/or multi-key expression', () => {
    const b = userBuilder();
    b.order((u: any) => [u.age.asc, u.id.desc]);
    b.cursor((u: any) => or(u.age.gt(30), and(u.age.eq(30), u.id.lt(500))));
    expect(b.sqb.cursor.elements.length).toBe(1);
    const group = (b.sqb.cursor.elements[0] as any).condition as {
      elements: unknown[];
    };
    expect(group.elements.length).toBe(2);
  });

  it('throws without order()', () => {
    const b = userBuilder();
    expect(() => b.cursor((u: any) => u.id.gt(42))).toThrow(
      /requires an order/,
    );
    expect(b.sqb.cursor.elements.length).toBe(0);
  });

  it('throws when offset() already set', () => {
    const b = userBuilder();
    b.offset(5);
    b.order((u: any) => [u.id.asc]);
    expect(() => b.cursor((u: any) => u.id.gt(42))).toThrow(
      /cannot be combined/,
    );
  });

  it('throws when called twice', () => {
    const b = userBuilder();
    b.order((u: any) => [u.id.asc]);
    b.cursor((u: any) => u.id.gt(42));
    expect(() => b.cursor((u: any) => u.id.gt(43))).toThrow(/already set/);
    expect(b.sqb.cursor.elements.length).toBe(1);
  });

  it('offset() after cursor throws', () => {
    const b = userBuilder();
    b.order((u: any) => [u.id.asc]);
    b.cursor((u: any) => u.id.gt(42));
    expect(() => b.offset(5)).toThrow(/cannot be combined/);
    expect(b.sqb.offset).toBeNull();
  });

  it('page() after cursor throws', () => {
    const b = userBuilder();
    b.order((u: any) => [u.id.asc]);
    b.cursor((u: any) => u.id.gt(42));
    expect(() => b.page(2, 10)).toThrow(/cannot be combined/);
  });

  it('skips undefined expression (cursor not set)', () => {
    const b = userBuilder();
    b.order((u: any) => [u.id.asc]);
    b.cursor(() => undefined as any);
    expect(b.sqb.cursor.elements.length).toBe(0);
    b.offset(5);
    expect(b.sqb.offset).toBe(5);
  });
});

describe('SelectQueryBuilder — having', () => {
  it('pushes aggregate-alias condition to sqb.havings', () => {
    const b = userBuilder();
    b.fields((t, { agg }: any) => [t.id, agg.count('*').as('total')]);
    b.having((t: any) => t.total.gt(5));
    expect(b.sqb.havings.elements.length).toBe(1);
    const c = b.sqb.havings.elements[0].condition as {
      field: string;
      op: string;
      alias?: string;
    };
    expect(c.field).toBe('total');
    expect(c.op).toBe('>');
    expect(c.alias).toBe('');
  });

  it('throws on unknown aggregate alias with .as() hint', () => {
    const b = userBuilder();
    b.fields((t: any) => [t.id]);
    expect(() => b.having((t: any) => t.total.gt(1))).toThrow(
      'Unknown aggregate alias',
    );
    expect(() => b.having((t: any) => t.total.gt(1))).toThrow(/\.as\("/);
  });

  it('clone() copies havings', () => {
    const b = userBuilder();
    b.fields((t, { agg }: any) => [t.id, agg.count('*').as('total')]);
    b.having((t: any) => t.total.gt(5));
    const c = b.clone();
    expect(c.sqb.havings.elements.length).toBe(1);
  });

  it('havingOr appends an OR step (no auto-grouping)', () => {
    const b = userBuilder();
    b.fields((t, { agg }: any) => [t.id, agg.count('*').as('total')]);
    b.having((t: any) => t.total.gt(5));
    b.havingOr((t: any) => t.total.lt(1));
    expect(b.sqb.havings.elements.length).toBe(2);
    expect((b.sqb.havings.elements[1] as any).join).toBe('OR');
  });
});

describe('SelectQueryBuilder — count', () => {
  it('returns number via go()', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ count: '5' }]);
    const b = userBuilder(adapter);
    const result = await b.count().go();
    expect(result).toBe(5);
  });

  it('returns 0 when no rows', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = userBuilder(adapter);
    const result = await b.count().go();
    expect(result).toBe(0);
  });

  it('count() resets limit/offset (S2)', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ count: '7' }]);
    const b = userBuilder(adapter).limit(10).offset(5);
    await b.count().go();
    const sqb: any = adapter.execute.mock.calls[0][0];
    expect(sqb.limit).toBeNull();
    expect(sqb.offset).toBeNull();
  });
});

describe('SelectQueryBuilder — exists', () => {
  it('returns true when rows exist', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1 }]);
    const b = userBuilder(adapter);
    const result = await b.exists().go();
    expect(result).toBe(true);
  });

  it('returns false when no rows', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = userBuilder(adapter);
    const result = await b.exists().go();
    expect(result).toBe(false);
  });

  it('exists() resets offset and keeps LIMIT 1 (S3)', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([{ id: 1 }]);
    const b = userBuilder(adapter).offset(5);
    await b.exists().go();
    const sqb: any = adapter.execute.mock.calls[0][0];
    expect(sqb.offset).toBeNull();
    expect(sqb.limit).toBe(1);
  });
});

describe('SelectQueryBuilder — toSql', () => {
  it('throws without adapter', () => {
    const b = userBuilder();
    expect(() => b.toSql()).toThrow('No adapter configured');
  });

  it('returns formatted string', () => {
    const adapter = makeMockAdapter();
    adapter.toSql.mockReturnValue({ text: 'SELECT 1', values: [] });
    const b = userBuilder(adapter);
    expect(b.toSql()).toBe('SQL: SELECT 1\nVALUES: []');
  });
});

describe('SelectQueryBuilder — go', () => {
  it('throws without adapter', async () => {
    const b = userBuilder();
    await expect(b.go()).rejects.toThrow('No adapter configured');
  });

  it('auto-selects fields into a snapshot, not the builder', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = userBuilder(adapter);
    await b.go();
    expect(b.sqb.selects).toBeNull();
    expect(adapter.execute).toHaveBeenCalledWith(
      expect.objectContaining({ selects: expect.any(Array) }),
    );
  });
});

describe('SelectQueryBuilder — clone', () => {
  it('returns an independent builder', () => {
    const b = userBuilder();
    const c = b.clone();
    c.where((u: any) => u.name.eq('Alice'));
    c.limit(10);
    expect(b.sqb.wheres.elements.length).toBe(0);
    expect(b.sqb.limit).toBeNull();
    expect(c.sqb.wheres.elements.length).toBe(1);
    expect(c.sqb.limit).toBe(10);
  });

  it('copies state from the source', () => {
    const b = userBuilder();
    b.where((u: any) => u.name.eq('Alice'));
    b.first();
    const c = b.clone();
    expect(c.sqb.wheres.elements.length).toBe(1);
    expect(c.sqb.limit).toBe(1);
  });

  it('deep-copies aggregate selects', () => {
    const b = userBuilder();
    b.fields((_t, { agg }: any) => [agg.count('*').as('total')]);
    const c = b.clone();
    (c.sqb.selects![0] as any).as('renamed');
    expect((b.sqb.selects![0] as any).alias).toBe('total');
  });

  it('go() twice produces identical snapshots', async () => {
    const adapter = makeMockAdapter();
    adapter.execute.mockResolvedValue([]);
    const b = userBuilder(adapter);
    await b.go();
    await b.go();
    const [first, second] = adapter.execute.mock.calls;
    expect(first![0].selects).toEqual(second![0].selects);
    expect(b.sqb.selects).toBeNull();
  });
});
