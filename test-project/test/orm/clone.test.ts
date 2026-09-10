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

describe('clone: safe builder reuse via snapshots', () => {
  it('clone() branches a reused builder independently', async () => {
    const base = h.orm.single(UserModel);
    const all = await base.clone().go();
    const firstPage = await base.clone().page(1, 2).go();
    expect(all).toHaveLength(3);
    expect(firstPage).toHaveLength(2);
    // пагинация на клоне не прилипла к базе
    expect(base.sqb.limit).toBeNull();
  });

  it('go() auto-selects into a snapshot, not the builder', async () => {
    const base = h.orm.single(UserModel);
    await base.go();
    const again = await base.go();
    expect(again).toHaveLength(3);
  });

  it('count() no longer overwrites the builder select', async () => {
    const base = h.orm.single(UserModel).select((u) => [u.name]);
    const n = await base.count().go();
    const rows = await base.go();
    expect(n).toBe(3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ name: 'Alice' });
  });

  it('exists() no longer leaves limit(1) on the builder', async () => {
    const base = h.orm.single(UserModel).order((u) => [u.name.asc]);
    const yes = await base.exists().go();
    const rows = await base.go();
    expect(yes).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('update() works on a snapshot; builder stays reusable', async () => {
    const base = h.orm.single(UserModel);
    const u1 = await base
      .update({ age: 31 })
      .where((u) => u.name.eq('Alice'))
      .go();
    const u2 = await base
      .update({ age: 26 })
      .where((u) => u.name.eq('Bob'))
      .go();
    expect(u1[0].age).toBe(31);
    expect(u2[0].age).toBe(26);
    expect(base.sqb.operation).toBe('select');
    expect(await base.go()).toHaveLength(3);
  });

  it('multi clone() branches a query independently', async () => {
    const base = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) });
    const alice = await base
      .clone()
      .where((t) => t.u.name.eq('Alice'))
      .select((t) => [t.u.name, t.p.title])
      .go();
    const bob = await base
      .clone()
      .where((t) => t.u.name.eq('Bob'))
      .select((t) => [t.u.name, t.p.title])
      .go();
    expect(alice.map((r) => r.p.title).sort()).toEqual([
      'Draft Post',
      'Hello Postgres',
    ]);
    expect(bob.map((r) => r.p.title)).toEqual(['Bob Writes']);
    expect(base.sqb.wheres.elements.length).toBe(0);
  });
});