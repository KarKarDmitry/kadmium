import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('update edges: null, все строки, boolean', () => {
  it('update a column to null', async () => {
    const [alice] = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields((u) => [u.id, u.age])
      .go();
    const originalAge = alice.age;
    await h.orm
      .update(UserModel)
      .set({ age: null })
      .where((u) => u.id.eq(alice.id))
      .go();
    const [updated] = await h.orm
      .select(UserModel)
      .where((u) => u.id.eq(alice.id))
      .fields((u) => [u.age])
      .go();
    expect(updated.age).toBeNull();
    // restore for other tests
    await h.orm
      .update(UserModel)
      .set({ age: originalAge })
      .where((u) => u.id.eq(alice.id))
      .go();
  });

  it('update all rows (no where clause)', async () => {
    await h.orm.update(UserModel).set({ active: false }).go();
    const all = await h.orm
      .select(UserModel)
      .fields((u) => [u.active])
      .go();
    expect(all.every((r) => r.active === false)).toBe(true);
    // restore: reactivate all
    await h.orm.update(UserModel).set({ active: true }).go();
  });

  it('boolean false is distinct from null', async () => {
    await h.orm.update(UserModel).set({ active: false }).go();
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.active.eq(false))
      .fields((u) => [u.name])
      .go();
    expect(rows.length).toBeGreaterThan(0);
    await h.orm.update(UserModel).set({ active: true }).go();
  });
});
