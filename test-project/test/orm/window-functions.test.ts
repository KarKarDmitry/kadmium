import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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

// Данные: Hello Postgres (views 10, alice), Draft Post (views 0, alice), Bob Writes (views 5, bob)
describe('window functions', () => {
  it('row_number() OVER () numbers every row', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, { wf }) => [p.title, wf.rowNumber().as('rn')])
      .go();
    expect(rows).toHaveLength(3);
    const rns = rows.map((r) => r.rn).sort();
    expect(rns).toEqual([1, 2, 3]);
  });

  it('rank() per author over views desc', async () => {
    const rows = await h.orm
      .single(PostModel)
      .order((p) => [p.views.desc])
      .select((p, { wf }) => [
        p.title,
        p.views,
        wf.rank().partitionBy(p.author).orderBy(p.views.desc).as('rank'),
      ])
      .go();
    // 10 (alice) → rank 1 в своей партиции; 5 (bob) → rank 1; 0 (alice) → rank 2
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 2]);
  });

  it('row_number() per author over views desc', async () => {
    const rows = await h.orm
      .single(PostModel)
      .order((p) => [p.views.desc])
      .select((p, { wf }) => [
        p.title,
        p.views,
        wf.rowNumber().partitionBy(p.author).orderBy(p.views.desc).as('rn'),
      ])
      .go();
    expect(rows.map((r) => r.rn)).toEqual([1, 1, 2]);
  });

  it('windowed SUM() OVER () equals per-author totals', async () => {
    const rows = await h.orm
      .single(PostModel)
      .order((p) => [p.views.desc])
      .select((p, { agg }) => [
        p.views,
        agg.sum(p.views).over().partitionBy(p.author).as('authorTotal'),
      ])
      .go();
    // 10 + 0 = 10 (alice) → её обе строки; 5 (bob)
    expect(rows.map((r) => r.authorTotal)).toEqual([10, 5, 10]);
  });

  it('running total via ORDER BY alone', async () => {
    const rows = await h.orm
      .single(PostModel)
      .order((p) => [p.views.desc])
      .select((p, { agg }) => [
        p.views,
        agg.sum(p.views).over().orderBy(p.views.desc).as('running'),
      ])
      .go();
    expect(rows.map((r) => r.running)).toEqual([10, 15, 15]);
  });

  it('lead() with offset and default pushes parameters', async () => {
    const rows = await h.orm
      .single(PostModel)
      .order((p) => [p.views.desc])
      .select((p, { wf }) => [
        p.title,
        p.views,
        wf.lead(p.views, 1, 0).orderBy(p.views.desc).as('nextViews'),
      ])
      .go();
    // 10 → следующая 5; 5 → 0; 0 → default 0
    expect(rows.map((r) => r.nextViews)).toEqual([5, 0, 0]);
  });

  it('rowsBetween frame: moving average over 2 preceding rows', async () => {
    const rows = await h.orm
      .single(PostModel)
      .order((p) => [p.views.desc])
      .select((p, { agg }) => [
        p.views,
        agg
          .avg(p.views)
          .over()
          .orderBy(p.views.desc)
          .rowsBetween('unbounded', 'current')
          .as('avgSoFar'),
      ])
      .go();
    // 10 → 10; (10+5)/2=7.5 → 7.5; (10+5+0)/3=5 → 5
    // AVG(int) приходит numeric-строкой → Number()
    expect(rows.map((r) => Number(r.avgSoFar))).toEqual([10, 7.5, 5]);
  });
});