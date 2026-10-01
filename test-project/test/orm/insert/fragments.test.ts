import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from '@karkardmitry/kadmium-core';
import { User as UserModel, Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';

let h: Harness;
let seedData: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seedData = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('insert — sql-выражения в значениях и onConflict (F)', () => {
  it('values({ registeredAt: sql`now()` }) — функция БД', async () => {
    const created = await h.orm
      .insert(UserModel)
      .values({
        name: 'NowUser',
        email: 'now@test.com',
        age: 42,
        active: true,
        registeredAt: sql`now()`,
      })
      .go();
    expect(created.registeredAt).toBeInstanceOf(Date);
  });

  it('insertMany с фрагментом-ячейкой (выражение со сдвигом $N)', async () => {
    const rows = await h.orm
      .insertMany(PostModel)
      .values([
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
        .insertMany(UserModel)
        .values([
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
      .insertMany(UserModel)
      .values([{ name: 'dup-a', email: 'conflict@test.com', age: 10 }])
      .onConflict((t) => [t.email])
      .set({ age: 99 })
      .go();
    expect(res[0].age).toBe(99);
  });

  it('set() без onConflict — ошибка', () => {
    const finalizer = h.orm
      .insertMany(UserModel)
      .values([{ name: 'x', email: 'x@test.com', age: 1 }]);
    expect(() => finalizer.set({ age: sql`5` })).toThrow(
      'set() requires onConflict() first',
    );
  });

  it('doNothing + set() → DO NOTHING (set игнорируется)', async () => {
    const email = 'nothing@test.com';
    const mk = () =>
      h.orm
        .insertMany(UserModel)
        .values([{ name: 'n', email, age: 1 }])
        .onConflict((t) => [t.email]);
    await mk().go();
    await mk().doNothing().set({ age: 2 }).go();
    const after = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq(email))
      .fields((t) => [t.age])
      .go();
    expect(after[0].age).toBe(1);
  });
});
