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

describe('filter edges: пустой список, null, notNull', () => {
  it('IN([]) renders 1=0 and returns no rows', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.id.in([]))
      .fields((u) => [u.id])
      .go();
    expect(rows).toEqual([]);
  });

  it('.null builds IS NULL', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.age.null)
      .fields((u) => [u.name])
      .go();
    expect(Array.isArray(rows)).toBe(true);
    // seeded users all have non-null age → 0
    expect(rows.length).toBe(0);
  });

  it('.notNull builds IS NOT NULL', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.age.notNull)
      .fields((u) => [u.name])
      .go();
    expect(rows.length).toBeGreaterThan(0);
  });
});
