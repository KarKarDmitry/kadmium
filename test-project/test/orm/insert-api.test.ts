import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed, type SeedData } from '../fixtures';
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

describe('insert API: entry point', () => {
  it('insert() is absent from select() - entries are separate', () => {
    // @ts-expect-error insert() не существует на select-API
    expect(h.orm.select(UserModel).insert).toBeUndefined();
  });

  it('insert() is absent from update() and delete()', () => {
    // @ts-expect-error insert() не существует на update-API
    expect(h.orm.update(UserModel).insert).toBeUndefined();
    // @ts-expect-error insert() не существует на delete-API
    expect(h.orm.delete(UserModel).insert).toBeUndefined();
  });

  it('insert() exposes only write steps, no select-only steps', () => {
    const i = h.orm.insert(UserModel);
    expect(typeof i.values).toBe('function');
    expect(typeof i.onConflict).toBe('function');
    expect(typeof i.set).toBe('function');
    expect(typeof i.doNothing).toBe('function');
    expect(typeof i.returning).toBe('function');
    expect(typeof i.go).toBe('function');
    // Шаги, которые sql-pg не рендерит в INSERT. Их отсутствие — основной
    // защитник: `.where(...).create()` фильтр потерял бы молча.
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
    // @ts-expect-error update() — другой write-вход
    expect(i.update).toBeUndefined();
    // @ts-expect-error delete() — другой write-вход
    expect(i.delete).toBeUndefined();
  });

  it('create() is absent from insert handle', () => {
    // @ts-expect-error create() — legacy-имя, в новом API values()
    expect(h.orm.insert(UserModel).create).toBeUndefined();
    // @ts-expect-error createMany() — отдельный вход insertMany()
    expect(h.orm.insert(UserModel).createMany).toBeUndefined();
  });
});

describe('insert API: values is mandatory', () => {
  it('go() without values() throws', () => {
    expect(() => h.orm.insert(UserModel).go()).toThrow(/requires values/);
  });

  it('returning() without values() throws', () => {
    expect(() =>
      h.orm.insert(UserModel).returning((u) => [u.id]),
    ).toThrow(/requires values/);
  });

  it('onConflict() without values() throws', () => {
    expect(() =>
      h.orm.insert(UserModel).onConflict((u) => [u.email]),
    ).toThrow(/requires values/);
  });

  it('sql() without values() throws', () => {
    expect(() => h.orm.insert(UserModel).sql()).toThrow(/requires values/);
  });

  it('set() without values() throws before the onConflict() check', () => {
    // Порядок проверок: сначала обязательный values, потом требование
    // onConflict. Иначе сообщение указывало бы на шаг, который ещё не вызван.
    expect(() => h.orm.insert(UserModel).set({ age: 1 })).toThrow(
      /requires values/,
    );
  });
});

describe('insert API: values + go', () => {
  it('inserts a row and returns the full model', async () => {
    const created = await h.orm
      .insert(UserModel)
      .values({ name: 'Dave', email: 'dave@test.com', age: 33 })
      .go();

    expect(created).toMatchObject({
      name: 'Dave',
      email: 'dave@test.com',
      age: 33,
    });
    expect(created.id).toBeDefined();

    const inDb = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('dave@test.com'))
      .go();
    expect(inDb).toHaveLength(1);
  });

  it('applies column defaults not present in values()', async () => {
    const created = await h.orm
      .insert(PostModel)
      .values({ title: 'Defaults', content: 'body' })
      .go();

    // published/views имеют .default() в модели — БД проставила их сама.
    expect(created.published).toBe(true);
    expect(created.views).toBe(0);
  });

  it('values() accepts a callback that builds an expression', async () => {
    // Ограничение VALUES: ссылаться на поля модели нельзя — у INSERT нет
    // FROM, а рендер квалифицирует ссылку алиасом (PG 42P01). Коллбэк
    // полезен для фрагментов без полей модели.
    const created = await h.orm
      .insert(UserModel)
      .values(() => ({
        name: sql`upper(${'cb'})`,
        email: 'cb@test.com',
      }))
      .go();

    expect(created.name).toBe('CB');
  });

  it('values() accepts a fieldless sql fragment', async () => {
    const created = await h.orm
      .insert(UserModel)
      .values({
        name: 'Now',
        email: 'now@test.com',
        registeredAt: sql`now()`,
      })
      .go();

    expect(created.registeredAt).toBeInstanceOf(Date);
  });

  it('values() maps field names to column aliases', async () => {
    const created = await h.orm
      .insert(PostModel)
      .values({ title: 'Aliased', content: 'body', views: 3 })
      .go();

    // `views` — обычное имя, проверяем что оно дошло; алиасы проверяются
    // на моделях с alias (Comment.flagged → is_flagged).
    expect(created.views).toBe(3);
  });

  it('does not consume the builder - a second go() re-inserts', async () => {
    const base = h.orm.insert(UserModel).values({ name: 'Twice', email: 't@x.io' });
    const first = await base.go();
    // Второй go() идёт по тому же sqb: unique-конфликт честно падает,
    // косвенно доказывая, что данные не были сняты первым вызовом.
    await expect(base.go()).rejects.toThrow(/unique constraint/);
    expect(first.name).toBe('Twice');
    expect(await h.orm.select(UserModel).count().go()).toBe(4);
  });

  it('a second go() succeeds when no unique constraint blocks it', async () => {
    const base = h.orm.insert(PostModel).values({ title: 'Dup', content: 'body' });
    const before = await h.orm.select(PostModel).count().go();
    const first = await base.go();
    const second = await base.go();
    expect(second.id).not.toBe(first.id);
    expect(await h.orm.select(PostModel).count().go()).toBe(before + 2);
  });
});

describe('insert API: onConflict + doNothing', () => {
  it('doNothing() on conflict keeps the existing row', async () => {
    const result = await h.orm
      .insert(UserModel)
      .values({ name: 'Alice NEW', email: 'alice@test.com' })
      .onConflict((u) => [u.email])
      .doNothing()
      .go();

    // doNothing → RETURNING пуст, результат {} (текущее поведение create()).
    expect(result).toEqual({});

    const stored = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'Alice' });
  });

  it('onConflict() does not fire when the key is free', async () => {
    const created = await h.orm
      .insert(UserModel)
      .values({ name: 'Fresh', email: 'fresh@test.com' })
      .onConflict((u) => [u.email])
      .doNothing()
      .go();

    expect(created).toMatchObject({ name: 'Fresh' });
  });

  it('doNothing() wins over set() at render time', async () => {
    await h.orm
      .insert(UserModel)
      .values({ name: 'Alice NEW', email: 'alice@test.com' })
      .onConflict((u) => [u.email])
      .set({ age: 99 })
      .doNothing()
      .go();

    const stored = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    // age не изменился: doNothing перебивает set.
    expect(stored[0]).toMatchObject({ name: 'Alice', age: 30 });
  });

  it('set() without onConflict() throws', () => {
    expect(() =>
      h.orm.insert(UserModel).values({ email: 'x@x.io' }).set({ age: 1 }),
    ).toThrow(/onConflict/);
  });
});

describe('insert API: onConflict + set (upsert)', () => {
  it('set() updates the conflicting row', async () => {
    const result = await h.orm
      .insert(UserModel)
      .values({ name: 'Alice Renamed', email: 'alice@test.com', age: 41 })
      .onConflict((u) => [u.email])
      .set({ name: 'Alice Upserted' })
      .go();

    expect(result).toMatchObject({ name: 'Alice Upserted' });

    const stored = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: 'Alice Upserted' });
  });

  it('set() survives across steps - conflict state is not lost', async () => {
    // Регрессия: если конфликтные шаги писали бы в одноразовый клон
    // финализатора, состояние потерялось бы к моменту go().
    await h.orm
      .insert(UserModel)
      .values({ name: 'X', email: 'alice@test.com' })
      .onConflict((u) => [u.email])
      .set({ age: 77 })
      .returning((u) => [u.age])
      .go();

    const stored = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('alice@test.com'))
      .go();
    expect(stored[0]).toMatchObject({ age: 77 });
  });
});

describe('insert API: returning', () => {
  it('returning() projects only the selected columns', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'Proj', email: 'proj@test.com' })
      .returning((u) => [u.id, u.name])
      .go();

    expect(Object.keys(row)).toEqual(['id', 'name']);
    expect(row.name).toBe('Proj');
  });

  it('returning() with .as() uses the alias as key', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'Aliased', email: 'al@test.com' })
      .returning((u) => [u.name.as('who')])
      .go();

    expect(row).toEqual({ who: 'Aliased' });
  });

  it('returning() on an upsert returns the updated row', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'N', email: 'alice@test.com' })
      .onConflict((u) => [u.email])
      .set({ age: 55 })
      .returning((u) => [u.age])
      .go();

    expect(row).toEqual({ age: 55 });
  });

  it('returning() returns {} when doNothing skips the write', async () => {
    const row = await h.orm
      .insert(UserModel)
      .values({ name: 'N', email: 'alice@test.com' })
      .onConflict((u) => [u.email])
      .doNothing()
      .returning((u) => [u.id])
      .go();

    expect(row).toEqual({});
  });
});

describe('insert API: sql preview', () => {
  it('sql() renders INSERT', () => {
    const text = h.orm
      .insert(UserModel)
      .values({ name: 'Alice', email: 'alice@test.com' })
      .sql();

    expect(text).toContain('INSERT INTO "user"');
  });

  it('sql() renders the conflict clause', () => {
    const text = h.orm
      .insert(UserModel)
      .values({ name: 'Alice', email: 'alice@test.com' })
      .onConflict((u) => [u.email])
      .doNothing()
      .sql();

    expect(text).toContain('ON CONFLICT');
    expect(text).toContain('DO NOTHING');
  });

  it('sql() renders RETURNING for a projection', () => {
    const text = h.orm
      .insert(UserModel)
      .values({ name: 'Alice' })
      .returning((u) => [u.id])
      .sql();

    expect(text).toContain('RETURNING');
  });
});

describe('insert API: legacy interop', () => {
  it('insert() and single().create() coexist in the same schema', async () => {
    await h.orm
      .insert(UserModel)
      .values({ name: 'NewAPI', email: 'new@test.com' })
      .go();
    await h.orm
      .single(UserModel)
      .create({ name: 'Legacy', email: 'legacy@test.com' })
      .go();

    const all = await h.orm.select(UserModel).go();
    expect(all).toHaveLength(5);
    expect(all.map((u) => u.name).sort()).toEqual([
      'Alice',
      'Bob',
      'Carol',
      'Legacy',
      'NewAPI',
    ]);
    expect(seed.alice.name).toBe('Alice');
  });
});