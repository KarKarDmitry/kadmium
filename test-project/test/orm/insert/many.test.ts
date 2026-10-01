import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';
import { sql } from '@karkardmitry/kadmium-core';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  await h.adapter.end();
});

beforeEach(async () => {
  seed = await resetAndSeed(h);
});

describe('insertMany API: entry point', () => {
  it('insertMany() is absent from insert() - entries are separate', () => {
    // @ts-expect-error insertMany() не существует на одиночном insert
    expect(h.orm.insert(UserModel).insertMany).toBeUndefined();
  });

  it('insertMany() is absent from select/update/delete', () => {
    // @ts-expect-error insertMany() не существует на select-API
    expect(h.orm.select(UserModel).insertMany).toBeUndefined();
    // @ts-expect-error insertMany() не существует на update-API
    expect(h.orm.update(UserModel).insertMany).toBeUndefined();
    // @ts-expect-error insertMany() не существует на delete-API
    expect(h.orm.delete(UserModel).insertMany).toBeUndefined();
  });

  it('insertMany() exposes only write steps, no select-only steps', () => {
    const i = h.orm.insertMany(UserModel);
    expect(typeof i.values).toBe('function');
    expect(typeof i.onConflict).toBe('function');
    expect(typeof i.set).toBe('function');
    expect(typeof i.doNothing).toBe('function');
    expect(typeof i.transaction).toBe('function');
    expect(typeof i.returning).toBe('function');
    expect(typeof i.go).toBe('function');
    // @ts-expect-error where() недоступен в INSERT
    expect(i.where).toBeUndefined();
    // @ts-expect-error order() недоступен в INSERT
    expect(i.order).toBeUndefined();
    // @ts-expect-error limit() недоступен в INSERT
    expect(i.limit).toBeUndefined();
    // @ts-expect-error offset() недоступен в INSERT
    expect(i.offset).toBeUndefined();
    // @ts-expect-error page() недоступен в INSERT
    expect(i.page).toBeUndefined();
    // @ts-expect-error cursor() недоступен в INSERT
    expect(i.cursor).toBeUndefined();
    // @ts-expect-error groupBy() недоступен в INSERT
    expect(i.groupBy).toBeUndefined();
    // @ts-expect-error include() недоступен в INSERT
    expect(i.include).toBeUndefined();
    // @ts-expect-error create() — другой вход
    expect(i.create).toBeUndefined();
    // @ts-expect-error createMany() — legacy-имя, в новом API values()
    expect(i.createMany).toBeUndefined();
  });

  it('insert() has no transaction() step - only batch has it', () => {
    // Транзакция — свойство батча (несколько операций); одиночный INSERT
    // всегда одной транзакцией, опции нечего переключать.
    // @ts-expect-error transaction() не объявлен на insert
    expect(h.orm.insert(UserModel).transaction).toBeUndefined();
  });
});

describe('insertMany API: values is mandatory and non-empty', () => {
  it('go() without values() throws', () => {
    expect(() => h.orm.insertMany(UserModel).go()).toThrow(/requires values/);
  });

  it('returning() without values() throws', () => {
    expect(() =>
      h.orm.insertMany(UserModel).returning((u) => [u.id]),
    ).toThrow(/requires values/);
  });

  it('transaction() without values() throws', () => {
    expect(() =>
      h.orm.insertMany(UserModel).transaction(false),
    ).toThrow(/requires values/);
  });

  it('sql() without values() throws', () => {
    expect(() => h.orm.insertMany(UserModel).sql()).toThrow(/requires values/);
  });

  it('values([]) is rejected - an empty batch is a caller mistake', () => {
    // Отличие от legacy createMany([]), который молча отдавал []: пустой
    // батч почти всегда — потерянные данные (забытый фильтр, неверный
    // source), и silent no-op это скрывал.
    const b = h.orm.insertMany(UserModel).values([]);
    expect(() => b.go()).toThrow(/at least one row/);
    expect(() => b.sql()).toThrow(/at least one row/);
    expect(() => b.transaction(false)).toThrow(/at least one row/);
  });

  it('nothing is written for a rejected empty batch', async () => {
    // Sync-throw до похода в БД: «ничего не записалось» — факт, а не исход.
    const before = await h.orm.select(UserModel).count().go();
    expect(() => h.orm.insertMany(UserModel).values([]).go()).toThrow(
      /at least one row/,
    );
    expect(await h.orm.select(UserModel).count().go()).toBe(before);
  });
});

describe('insertMany API: values + go', () => {
  it('inserts all rows and returns full models', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Ann', email: 'ann@test.com', age: 21 },
        { name: 'Ben', email: 'ben@test.com', age: 22 },
        { name: 'Cid', email: 'cid@test.com', age: 23 },
      ])
      .go();

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['Ann', 'Ben', 'Cid']);
    expect(rows.every((r) => r.id !== undefined)).toBe(true);
    expect(await h.orm.select(UserModel).count().go()).toBe(6);
  });

  it('accepts a single-row array', async () => {
    const rows = await h.orm
      .insertMany(PostModel)
      .values([{ title: 'Solo', content: 'body' }])
      .go();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'Solo', published: true });
  });

  it('applies column defaults per row', async () => {
    const rows = await h.orm
      .insertMany(PostModel)
      .values([
        { title: 'D1', content: 'a' },
        { title: 'D2', content: 'b' },
      ])
      .go();

    expect(rows.map((r) => r.views)).toEqual([0, 0]);
  });

  it('accepts a fieldless sql fragment per row', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: sql`upper(${'cb1'})`, email: 'cb1@test.com' },
        { name: sql`upper(${'cb2'})`, email: 'cb2@test.com' },
      ])
      .go();

    expect(rows.map((r) => r.name)).toEqual(['CB1', 'CB2']);
  });

  it('does not consume the builder - a second go() re-inserts', async () => {
    const base = h.orm
      .insertMany(PostModel)
      .values([{ title: 'Twice', content: 'body' }]);
    const before = await h.orm.select(PostModel).count().go();
    await base.go();
    await base.go();
    expect(await h.orm.select(PostModel).count().go()).toBe(before + 2);
  });
});

describe('insertMany API: transaction step', () => {
  it('transaction() can be called mid-chain and go() succeeds', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'Tx', email: 'tx@test.com' }])
      .transaction(false)
      .go();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Tx');
  });

  it('transaction(true) is the default', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'TxTrue', email: 'txt@test.com' }])
      .transaction(true)
      .go();

    expect(rows).toHaveLength(1);
  });

  it('last transaction() call wins', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'LastWins', email: 'lw@test.com' }])
      .transaction(false)
      .transaction(true)
      .go();

    expect(rows).toHaveLength(1);
  });
});

describe('insertMany API: onConflict + doNothing', () => {
  it('doNothing() skips conflicting rows and keeps fresh ones', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Alice NEW', email: 'alice@test.com' },
        { name: 'Zoe', email: 'zoe@test.com' },
      ])
      .onConflict((u) => [u.email])
      .doNothing()
      .go();

    // Одна строка вставлена, конфликтная пропущена.
    expect(rows.map((r) => r.name)).toEqual(['Zoe']);

    const stored = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .go();
    expect(stored[0]).toMatchObject({ name: 'Alice' });
  });

  it('doNothing() wins over set() at render time', async () => {
    await h.orm
      .insertMany(UserModel)
      .values([{ name: 'Alice NEW', email: 'alice@test.com', age: 99 }])
      .onConflict((u) => [u.email])
      .set({ age: 99 })
      .doNothing()
      .go();

    const stored = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    expect(stored[0]).toMatchObject({ name: 'Alice', age: 30 });
  });

  it('set() without onConflict() throws', () => {
    expect(() =>
      h.orm
        .insertMany(UserModel)
        .values([{ email: 'x@x.io' }])
        .set({ age: 1 }),
    ).toThrow(/onConflict/);
  });
});

describe('insertMany API: onConflict + set (upsert)', () => {
  it('set() updates conflicting rows', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Alice Upd', email: 'alice@test.com' },
        { name: 'Fresh', email: 'fresh@test.com' },
      ])
      .onConflict((u) => [u.email])
      .set({ name: 'Alice Batched' })
      .go();

    expect(rows.map((r) => r.name)).toEqual(['Alice Batched', 'Fresh']);

    const alice = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    expect(alice).toHaveLength(1);
    expect(alice[0].name).toBe('Alice Batched');
  });

  it('conflict state survives across steps', async () => {
    // Регрессия: конфликтные шаги должны писать в this.sqb, а не в
    // одноразовый клон финализатора.
    await h.orm
      .insertMany(UserModel)
      .values([{ name: 'X', email: 'alice@test.com' }])
      .onConflict((u) => [u.email])
      .set({ age: 66 })
      .transaction(false)
      .go();

    const alice = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    expect(alice[0]).toMatchObject({ age: 66, name: 'Alice' });
  });
});

describe('insertMany API: returning', () => {
  it('returning() projects only the selected columns', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'R1', email: 'r1@test.com' },
        { name: 'R2', email: 'r2@test.com' },
      ])
      .returning((u) => [u.id, u.name])
      .go();

    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0])).toEqual(['id', 'name']);
    expect(rows.map((r) => r.name)).toEqual(['R1', 'R2']);
  });

  it('returning() with .as() uses the alias as key', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'Al', email: 'al@test.com' }])
      .returning((u) => [u.name.as('who')])
      .go();

    expect(rows).toEqual([{ who: 'Al' }]);
  });

  it('returning() on upsert returns updated rows', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'N', email: 'alice@test.com' }])
      .onConflict((u) => [u.email])
      .set({ age: 44 })
      .returning((u) => [u.age])
      .go();

    expect(rows).toEqual([{ age: 44 }]);
  });

  it('returning() returns [] when doNothing skips everything', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'N', email: 'alice@test.com' }])
      .onConflict((u) => [u.email])
      .doNothing()
      .returning((u) => [u.id])
      .go();

    expect(rows).toEqual([]);
  });
});

describe('insertMany API: sql preview', () => {
  it('sql() renders INSERT', () => {
    const text = h.orm
      .insertMany(UserModel)
      .values([{ name: 'A', email: 'a@x.io' }])
      .sql();

    expect(text).toContain('INSERT INTO "user"');
  });

  it('sql() marks a multi-row preview', () => {
    // Батч уходит одним multi-row statement, но превью рендерит только первую
    // строку — без маркера превью читалось бы как одиночный INSERT.
    const text = h.orm
      .insertMany(UserModel)
      .values([
        { name: 'A', email: 'a@x.io' },
        { name: 'B', email: 'b@x.io' },
        { name: 'C', email: 'c@x.io' },
      ])
      .sql();

    expect(text).toContain('-- preview: first of 3 rows');
  });

  it('sql() renders the conflict clause', () => {
    const text = h.orm
      .insertMany(UserModel)
      .values([{ name: 'A', email: 'a@x.io' }])
      .onConflict((u) => [u.email])
      .set({ age: 1 })
      .sql();

    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO UPDATE SET');
  });
});

