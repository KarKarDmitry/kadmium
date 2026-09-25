import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from '@karkardmitry/kadmium-core';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed, type SeedData } from '../fixtures';

let h: Harness;
let seedData: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seedData = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('DML — sql-выражения в update/create/createMany/onConflict (F)', () => {
  it('update({ views: sql fragment }) — инкремент через RETURNING', async () => {
    const before = seedData.p1.views as number;
    const res = await h.orm
      .single(PostModel)
      .where((p) => p.id.eq(seedData.p1.id as number))
      .update({ views: sql`"Post"."views" + 1` })
      .go();
    expect(res[0].views).toBe(before + 1);
  });

  it('update((p) => ({ views: sql`${p.views} + 1` })) — proxy-реф', async () => {
    const before = seedData.p3.views as number;
    const res = await h.orm
      .single(PostModel)
      .update((p) => ({ views: sql`${p.views} + 1` }))
      .where((p) => p.id.eq(seedData.p3.id as number))
      .go();
    expect(res[0].views).toBe(before + 1);
  });

  it('sql()-превью содержит выражение в SET', async () => {
    const q = h.orm
      .single(PostModel)
      .where((p) => p.id.eq(seedData.p1.id as number))
      .update({ views: sql`"Post"."views" + 1` });
    expect(q.sql()).toContain('SET "views" = "Post"."views" + 1');
  });

  it('create({ registeredAt: sql`now()` }) — функция БД', async () => {
    const created = await h.orm
      .single(UserModel)
      .create({
        name: 'NowUser',
        email: 'now@test.com',
        age: 42,
        active: true,
        registeredAt: sql`now()`,
      })
      .go();
    expect(created.registeredAt).toBeInstanceOf(Date);
  });

  it('createMany с фрагментом-ячейкой (выражение со сдвигом $N)', async () => {
    const rows = await h.orm
      .single(PostModel)
      .createMany([
        {
          title: 'frag-a',
          author: seedData.alice.id,
          views: sql`${7}::int + ${3}::int`,
        },
        { title: 'frag-b', author: seedData.alice.id, views: 4 },
      ])
      .go();
    expect(rows.map((r) => r.views).sort((a, b) => a - b)).toEqual([4, 10]);
  });

  it('onConflict().set({ age: sql`..."+$5` }) — DO UPDATE SET выражением', async () => {
    const mk = () =>
      h.orm
        .single(UserModel)
        .createMany([
          { name: 'dup-a', email: 'conflict@test.com', age: 10 },
          { name: 'dup-b', email: 'conflict2@test.com', age: 20 },
        ])
        .onConflict((t) => [t.email])
        .set({ age: sql`"user"."age" + ${5}::int` })
        .go();
    await mk();
    const again = await mk();
    expect(again.map((r) => r.age).sort()).toEqual([15, 25]);
  });

  it('onConflict().set() — обычное значение параметром', async () => {
    const res = await h.orm
      .single(UserModel)
      .createMany([{ name: 'dup-a', email: 'conflict@test.com', age: 10 }])
      .onConflict((t) => [t.email])
      .set({ age: 99 })
      .go();
    expect(res[0].age).toBe(99);
  });

  it('set() без onConflict — ошибка', () => {
    const finalizer = h.orm
      .single(UserModel)
      .createMany([{ name: 'x', email: 'x@test.com', age: 1 }]);
    expect(() => finalizer.set({ age: sql`5` })).toThrow(
      'set() requires onConflict() first',
    );
  });

  it('doNothing + set() → DO NOTHING (set игнорируется)', async () => {
    const email = 'nothing@test.com';
    const mk = () =>
      h.orm
        .single(UserModel)
        .createMany([{ name: 'n', email, age: 1 }])
        .onConflict((t) => [t.email]);
    await mk().go();
    await mk().doNothing().set({ age: 2 }).go();
    const after = await h.orm
      .single(UserModel)
      .where((u) => u.email.eq(email))
      .select((t) => [t.age])
      .go();
    expect(after[0].age).toBe(1);
  });
});
