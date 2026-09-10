import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { or } from '@karkardmitry/kadmium-core';
import { Post as PostModel } from '../../src/models';
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

describe('having: filter grouped aggregates', () => {
  it('filters groups by COUNT(*) alias', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, aggs) => [p.author, aggs.count('*').as('cnt')])
      .groupBy((p) => [p.author])
      .having((t) => t.cnt.gt(1))
      .go();
    // Alice: 2 поста, Bob: 1, Carol: 0 → HAVING cnt > 1 оставляет только Alice
    expect(rows.length).toBe(1);
    expect(rows[0].cnt).toBe(2);
    expect(rows[0].author).not.toBeNull();
  });

  it('filters groups by SUM() with a numeric comparison', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, aggs) => [p.author, aggs.sum(p.views).as('totalViews')])
      .groupBy((p) => [p.author])
      .having((t) => t.totalViews.gt(5))
      .go();
    // Alice: 10, Bob: 5 → HAVING SUM(views) > 5 оставляет Alice
    expect(rows.length).toBe(1);
    expect(rows[0].totalViews).toBe(10);
  });

  it('WHERE applies before grouping (aggregate sees only filtered rows)', async () => {
    const rows = await h.orm
      .single(PostModel)
      .where((p) => p.published.eq(true))
      .select((p, aggs) => [p.author, aggs.count('*').as('cnt')])
      .groupBy((p) => [p.author])
      .having((t) => t.cnt.gt(1))
      .go();
    // У Alice опубликован только 1 пост → ни одна группа не проходит HAVING cnt > 1
    expect(rows).toEqual([]);
  });

  it('multiple having() calls combine with AND', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, aggs) => [p.author, aggs.count('*').as('cnt'), aggs.sum(p.views).as('totalViews')])
      .groupBy((p) => [p.author])
      .having((t) => t.cnt.eq(2))
      .having((t) => t.totalViews.gt(5))
      .go();
    // Alice: cnt=2 AND totalViews=10 → проходит; Bob: cnt=1 → отсекается первым
    expect(rows.length).toBe(1);
    expect(rows[0].cnt).toBe(2);
    expect(rows[0].totalViews).toBe(10);
  });

  it('havingOr composes OR across aggregate aliases', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, aggs) => [p.author, aggs.count('*').as('cnt'), aggs.sum(p.views).as('totalViews')])
      .groupBy((p) => [p.author])
      .having((t) => t.cnt.eq(1))
      .havingOr((t) => t.totalViews.gt(5))
      .go();
    // Bob (cnt=1) OR Alice (totalViews=10>5) → обе проходят
    expect(rows.length).toBe(2);
  });

  it('or() expression nests a parenthesized subclause', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, aggs) => [p.author, aggs.count('*').as('cnt'), aggs.sum(p.views).as('totalViews')])
      .groupBy((p) => [p.author])
      .having((t) => or(t.cnt.gt(0), t.totalViews.gt(100)))
      .go();
    // (cnt > 0 OR totalViews > 100): у обеих cnt≥1, Alice и Bob проходят
    expect(rows.length).toBe(2);
  });
});