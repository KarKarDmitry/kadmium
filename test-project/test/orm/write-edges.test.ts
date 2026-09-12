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

describe('write edges: null, empty, types, bulk', () => {
  it('update a column to null', async () => {
    const [alice] = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .select((u) => [u.id, u.age])
      .go();
    const originalAge = alice.age;
    await h.orm
      .single(UserModel)
      .update({ age: null })
      .where((u) => u.id.eq(alice.id))
      .go();
    const [updated] = await h.orm
      .single(UserModel)
      .where((u) => u.id.eq(alice.id))
      .select((u) => [u.age])
      .go();
    expect(updated.age).toBeNull();
    // restore for other tests
    await h.orm
      .single(UserModel)
      .update({ age: originalAge })
      .where((u) => u.id.eq(alice.id))
      .go();
  });

  it('create() with empty object uses DB defaults (or passes through)', async () => {
    // comment has `text default ''` and non-null refs → provide required refs.
    const { Comment: CommentModel } = await import('../../src/models');
    const comment = await h.orm
      .single(CommentModel)
      .create({
        text: '',
        post: null,
        user: null,
      })
      .go();
    expect(comment.id).toBeDefined();
  });

  it('IN([]) renders 1=0 and returns no rows', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.id.in([]))
      .select((u) => [u.id])
      .go();
    expect(rows).toEqual([]);
  });

  it('datetime roundtrip preserves ms precision', async () => {
    const ts = new Date('2024-06-15T14:30:45.123Z');
    const created = await h.orm
      .single(UserModel)
      .create({
        name: 'TsUser',
        email: 'ts@test.com',
        age: 99,
        active: true,
        registeredAt: ts,
      })
      .go();
    expect(created.registeredAt).toBeInstanceOf(Date);
    expect(created.registeredAt.getTime()).toBe(ts.getTime());
  });

  it('createMany with heterogeneous field subsets', async () => {
    const rows = await h.orm
      .single(UserModel)
      .createMany([
        { name: 'HM1', email: 'hm1@test.com', age: 10, active: true },
        { name: 'HM2', email: 'hm2@test.com', age: 20, active: false },
        { name: 'HM3', email: 'hm3@test.com', age: 30, active: true },
      ])
      .go();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.age).sort()).toEqual([10, 20, 30]);
  });

  it('update all rows (no where clause)', async () => {
    await h.orm.single(UserModel).update({ active: false }).go();
    const all = await h.orm
      .single(UserModel)
      .select((u) => [u.active])
      .go();
    expect(all.every((r) => r.active === false)).toBe(true);
    // restore: reactivate all
    await h.orm.single(UserModel).update({ active: true }).go();
  });

  it('.null builds IS NULL', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.age.null)
      .select((u) => [u.name])
      .go();
    expect(Array.isArray(rows)).toBe(true);
    // seeded users all have non-null age → 0
    expect(rows.length).toBe(0);
  });

  it('.notNull builds IS NOT NULL', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.age.notNull)
      .select((u) => [u.name])
      .go();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('boolean false is distinct from null', async () => {
    await h.orm.single(UserModel).update({ active: false }).go();
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.active.eq(false))
      .select((u) => [u.name])
      .go();
    expect(rows.length).toBeGreaterThan(0);
    await h.orm.single(UserModel).update({ active: true }).go();
  });

  it('numeric zero edge: age=0 is treated as a valid value', async () => {
    const created = await h.orm
      .single(UserModel)
      .create({
        name: 'ZeroAge',
        email: 'zero@test.com',
        age: 0,
        active: true,
      })
      .go();
    expect(created.age).toBe(0);
    const [fetched] = await h.orm
      .single(UserModel)
      .where((u) => u.id.eq(created.id))
      .select((u) => [u.age])
      .go();
    expect(fetched.age).toBe(0);
  });
});
