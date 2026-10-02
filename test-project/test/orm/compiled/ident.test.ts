import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql, ident } from '@karkardmitry/kadmium-core';
import { User as UserModel, Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seed = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('ident() — динамические идентификаторы против PG (G)', () => {
  it('raw: ident в SELECT/FROM — те же строки, что билдер', async () => {
    const rows = await h.orm
      .raw<{ name: string }>(
        sql`SELECT ${ident('name')} FROM ${ident('user')} WHERE active`,
      )
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Carol']);
  });

  it('raw: qualified-композиция ${ident("u")}.${ident("c")}', async () => {
    const rows = await h.orm
      .raw<{ uname: string }>(
        sql`SELECT ${ident('u')}.${ident('name')} AS uname
            FROM "user" AS u
            ORDER BY ${ident('u')}.${ident('name')}`,
      )
      .go();
    expect(rows.map((r) => r.uname)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('динамическая сортировка через билдер: order(sql`${ident(...)}`.desc)', async () => {
    const rows = await h.orm
      .select(UserModel)
      .order(() => [sql`${ident('age')}`.desc])
      .fields((u) => [u.name, u.age])
      .go();
    expect(rows.map((r) => ({ name: r.name, age: r.age }))).toEqual([
      { name: 'Carol', age: 40 },
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('динамическая колонка в WHERE с квалификацией', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where(() => sql`"User".${ident('name')} ILIKE ${'a%'}`)
      .fields((u) => [u.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Alice']);
  });

  it('ident в DML-значении: set({ views: sql`${ident(...)} + $N::int` })', async () => {
    const before = seed.p1.views;
    const res = await h.orm
      .update(PostModel)
      .set({ views: sql`${ident('views')} + ${1}::int` })
      .where((p) => p.id.eq(seed.p1.id))
      .go();
    expect(res[0].views).toBe(before + 1);
  });

  it('инвалидные idents, в т.ч. dotted — throw', () => {
    expect(() => ident('user.id')).toThrow(/Invalid SQL identifier/);
    expect(() => ident('')).toThrow(/Invalid SQL identifier/);
    expect(() => ident('col; DROP')).toThrow(/Invalid SQL identifier/);
  });
});
