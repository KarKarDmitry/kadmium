import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';
import { sql } from '@karkardmitry/kadmium-core';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seed = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('update API: entry point', () => {
  it('update() is absent from select() — entries are separate', () => {
    // @ts-expect-error update() не существует на select-API
    expect(h.orm.select(UserModel).update).toBeUndefined();
  });

  it('update() is absent from select handle after config steps', () => {
    // @ts-expect-error update() не существует на select-API даже после where
    expect(h.orm.select(UserModel).where((u) => u.active.eq(true)).update).toBeUndefined();
  });

  it('update() exposes only DML steps, no select-only steps', () => {
    const u = h.orm.update(UserModel);
    expect(typeof u.set).toBe('function');
    expect(typeof u.where).toBe('function');
    expect(typeof u.returning).toBe('function');
    expect(typeof u.go).toBe('function');
    // Шаги, которые sql-pg не рендерит в UPDATE, отсутствуют и на типе,
    // и в рантайме: их нельзя случайно применить молча.
    // @ts-expect-error order() недоступен в UPDATE
    expect(u.order).toBeUndefined();
    // @ts-expect-error limit() недоступен в UPDATE
    expect(u.limit).toBeUndefined();
    // @ts-expect-error include() недоступен в UPDATE
    expect(u.include).toBeUndefined();
    // @ts-expect-error first() недоступен в UPDATE
    expect(u.first).toBeUndefined();
    // @ts-expect-error fields() — это проекция чтения
    expect(u.fields).toBeUndefined();
    // @ts-expect-error count() — терминал чтения
    expect(u.count).toBeUndefined();
  });
});

describe('update API: set + where + go', () => {
  it('set().where().go() updates only matching rows', async () => {
    const rows = await h.orm
      .update(UserModel)
      .set({ age: 41 })
      .where((u) => u.name.eq('Bob'))
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Bob', age: 41 });

    const untouched = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .go();
    expect(untouched[0].age).toBe(30);
  });

  it('where() is optional — UPDATE without filter hits every row', async () => {
    await h.orm.update(UserModel).set({ active: true }).go();
    const users = await h.orm.select(UserModel).go();
    expect(users.every((u) => u.active)).toBe(true);
  });

  it('where() with no match updates nothing', async () => {
    const rows = await h.orm
      .update(UserModel)
      .set({ age: 99 })
      .where((u) => u.name.eq('Nobody'))
      .go();
    expect(rows).toEqual([]);
  });

  it('set() is mandatory — go() before set() throws at the call site', () => {
    // Синхронный throw, а не rejected promise: это ошибка сборки запроса,
    // и ловить её надо в точке вызова — так же, как гарды DML.
    expect(() => h.orm.update(UserModel).go()).toThrow(/requires set/);
    expect(() => h.orm.update(UserModel).where((u) => u.active.eq(true))).toThrow(
      /requires set/,
    );
  });

  it('set() maps field names to column aliases', async () => {
    // registeredAt -> колонка registeredAt; проверяем, что значение доехало.
    const when = new Date('2025-06-01T00:00:00Z');
    await h.orm
      .update(UserModel)
      .set({ registeredAt: when })
      .where((u) => u.name.eq('Carol'))
      .go();
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Carol'))
      .go();
    // Драйвер отдаёт datetime как Date, а не строкой.
    expect(rows[0].registeredAt).toBeInstanceOf(Date);
    expect(rows[0].registeredAt?.toISOString()).toBe(when.toISOString());
  });
});

describe('update API: returning', () => {
  it('returning() projects only the selected columns', async () => {
    const rows = await h.orm
      .update(UserModel)
      .set({ age: 42 })
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.id, u.age])
      .go();
    expect(rows).toEqual([{ id: seed.alice.id, age: 42 }]);
  });

  it('returning() with .as() uses the alias as key', async () => {
    const rows = await h.orm
      .update(UserModel)
      .set({ age: 43 })
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.age.as('years')])
      .go();
    expect(rows).toEqual([{ years: 43 }]);
  });

  it('returning() can be called without where()', async () => {
    const rows = await h.orm
      .update(PostModel)
      .set({ views: 100 })
      .returning((p) => [p.id])
      .go();
    expect(rows).toHaveLength(3);
  });
});

describe('update API: fragment values', () => {
  it('set() accepts a callback with the proxy for arithmetic', async () => {
    // Читаем текущее значение: предыдущие тесты уже меняли views,
    // поэтому фиксируем дельту, а не абсолютное число из сида.
    const before = await h.orm
      .select(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .first()
      .go();
    const rows = await h.orm
      .update(PostModel)
      .set((p) => ({ views: sql<number>`${p.views} + 5` }))
      .where((p) => p.title.eq('Hello Postgres'))
      .returning((p) => [p.views])
      .go();
    expect(rows).toEqual([{ views: (before?.views ?? 0) + 5 }]);
  });
});

describe('update API: sql preview', () => {
  it('sql() renders a readable preview with values inlined', () => {
    // Отличие от compile(): отладочный превью подставляет значения
    // в текст — это.by design, параметризованный путь здесь не требуется.
    const text = h.orm
      .update(UserModel)
      .set({ age: 50 })
      .where((u) => u.name.eq('Alice'))
      .sql();
    expect(text).toContain('UPDATE "user" AS "User"');
    expect(text).toContain('SET "age"');
    expect(text).toContain('WHERE');
  });
});