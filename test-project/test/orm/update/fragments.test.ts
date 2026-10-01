import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from '@karkardmitry/kadmium-core';
import { Post as PostModel } from '../../../src/models';
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

describe('update — sql-выражения в значениях (F)', () => {
  it('set({ views: sql fragment }) — инкремент через RETURNING', async () => {
    const before = seedData.p1.views;
    const res = await h.orm
      .update(PostModel)
      .set({ views: sql`"Post"."views" + 1` })
      .where((p) => p.id.eq(seedData.p1.id))
      .go();
    expect(res[0].views).toBe(before + 1);
  });

  it('set((p) => ({ views: sql`${p.views} + 1` })) — proxy-реф', async () => {
    const before = seedData.p3.views;
    const res = await h.orm
      .update(PostModel)
      .set((p) => ({ views: sql`${p.views} + 1` }))
      .where((p) => p.id.eq(seedData.p3.id))
      .go();
    expect(res[0].views).toBe(before + 1);
  });

  it('sql()-превью содержит выражение в SET', () => {
    const q = h.orm
      .update(PostModel)
      .set({ views: sql`"Post"."views" + 1` })
      .where((p) => p.id.eq(seedData.p1.id));
    expect(q.sql()).toContain('SET "views" = "Post"."views" + 1');
  });
});
