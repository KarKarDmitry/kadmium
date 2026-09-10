import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('where: filters, groups, ordering, pagination', () => {
  it('eq filter returns matching rows', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .go();
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe('alice@test.com');
  });

  it('gt / lt numeric filter', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.age.gt(25))
      .go();
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('like string filter', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.name.like('%ob'))
      .go();
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Bob');
  });

  it('and + or composition with correct precedence', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.age.gt(20))
      .and((u) => u.active.eq(true))
      .or((u) => u.name.eq('Bob'))
      .go();
    // (age>20 AND active) OR (name=Bob)  => Alice, Carol, Bob
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('group() creates parenthesized subclause', async () => {
    const rows = await h.orm
      .single(PostModel)
      .where((p) => p.published.eq(true))
      .group((q) =>
        q
          .where((p) => p.title.like('%Postgres%'))
          .or((p) => p.title.like('%Bob%')),
      )
      .go();
    // published AND (title~Postgres OR title~Bob) => оба опубликованы и подходят
    expect(rows.map((r) => r.title).sort()).toEqual([
      'Bob Writes',
      'Hello Postgres',
    ]);
  });

  it('order + limit + offset', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => [u.age.desc])
      .limit(2)
      .offset(1)
      .go();
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('Alice'); // age 30 (после Carol 40)
  });

  it('page() applies limit/offset', async () => {
    const page = await h.orm
      .single(UserModel)
      .select((u) => [u.name])
      .page(2, 2)
      .go();
    expect(page.length).toBe(1); // 3 пользователя, страница 2 по 2 => 1
    expect(page[0].name).toBe('Carol');
  });

  it('findById returns the row or undefined', async () => {
    const found = await h.orm.single(UserModel).findById(1).go();
    expect(found?.name).toBeTruthy();
    const missing = await h.orm.single(UserModel).findById(999999).go();
    expect(missing).toBeUndefined();
  });

  it('exists() reflects row presence', async () => {
    const yes = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .exists()
      .go();
    expect(yes).toBe(true);
    const no = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Nobody'))
      .exists()
      .go();
    expect(no).toBe(false);
  });

  it('count() combines with where and keeps the builder select', async () => {
    const q = h.orm.single(UserModel).where((u) => u.active.eq(true));
    const n = await q.count().go();
    expect(n).toBe(2); // Alice, Carol активны; Bob — нет
    const rows = await q.go();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
  });
});
