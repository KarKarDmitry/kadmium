import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { MultiQuerySlots, slot } from '@karkardmitry/kadmium-core';
import type { CompiledQuery } from '@karkardmitry/kadmium-sql-types';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed, type SeedData } from '../fixtures';

let h: Harness;
let seedData: SeedData;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Сверка двух каналов: обычный go() (прямой рендер → execute) и
 * compiled-канал (compile → fill → run → raw + reshape).
 * Результаты должны быть глубоко эквивалентны (порядок не гарантирован).
 */
function expectSameRows(actual: unknown[], expected: unknown[]): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expect.arrayContaining(expected));
  expect(expected).toEqual(expect.arrayContaining(actual));
}

beforeAll(async () => {
  h = await makeHarness();
  seedData = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('multi: go() vs run(compile()).fill().go()', () => {
  it('join + плоский slot() в where — parity, значения только параметрами', async () => {
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const join = { left: 'u' as const, right: 'p' as const };
    const direct = await q()
      .join({ ...join, on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.p.published.eq(true))
      .select((t) => [t.u.name, t.p.title])
      .go();
    const c = q()
      .join({ ...join, on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.p.published.eq(slot('published')))
      .select((t) => [t.u.name, t.p.title])
      .compile<{ published: boolean }>();
    const viaRun = await h.orm.run(c).fill({ published: true }).go();

    expectSameRows(viaRun, direct);
    expect(c.text).toContain('$1');
    expect(c.text).not.toContain('true');
  });

  it('typed MultiQuerySlots + where — ToDef/типы из алиасов, parity', async () => {
    const S = new MultiQuerySlots({
      u: UserModel,
      p: PostModel,
    }).push((t) => [t.p.views]);
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const direct = await q()
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.p.views.gt(7))
      .select((t) => [t.u.name, t.p.title])
      .go();
    const c = q()
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.p.views.gt(S.slot('views')))
      .select((t) => [t.u.name, t.p.title])
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ views: 7 }).go();

    expectSameRows(viaRun, direct);
    expect(viaRun.map((r) => r.p.title)).toEqual(['Hello Postgres']);
  });

  it('typed TResult миррорит go()', () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.views,
    ]);
    const b = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.p.views.gt(S.slot('views')))
      .select((t) => [t.u.name]);
    type R = Awaited<ReturnType<typeof b.go>>;
    const c = b.compile(S);
    const e: Equal<typeof c, CompiledQuery<{ views: number }, R>> = true;
    expect(e).toBe(true);
    expect(c.single).toBe(false);
  });

  it('слот в join().on — общий paramIndex, parity с go()', async () => {
    const authorId = seedData.alice.id as number;
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const direct = await q()
      .join({ left: 'u', right: 'p', on: (t) => t.p.author.eq(authorId) })
      .where((t) => t.u.id.eq(t.p.author))
      .select((t) => [t.p.title])
      .go();
    const c = q()
      .join({ left: 'u', right: 'p', on: (t) => t.p.author.eq(slot('author')) })
      .where((t) => t.u.id.eq(t.p.author))
      .select((t) => [t.p.title])
      .compile<{ author: number }>();
    const viaRun = await h.orm.run(c).fill({ author: authorId }).go();

    expectSameRows(viaRun, direct);
    expect(c.slotOrder.map((s) => s.name)).toContain('author');
  });

  it('order + limit + offset — parity', async () => {
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const base = () =>
      q()
        .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
        .order((t) => [t.p.views.desc]);
    const direct = await base().limit(2).select((t) => [t.p.title]).go();
    const c = base()
      .limit(2)
      .offset(0)
      .select((t) => [t.p.title])
      .compile<Record<string, never>>();
    const viaRun = await h.orm.run(c).fill({}).go();

    expect(viaRun).toEqual(direct);
    expect(viaRun.map((r) => r.p.title)).toEqual(['Hello Postgres', 'Bob Writes']);
  });

  it('include (LATERAL) + слот в include().where() — parity, форма не ломается', async () => {
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const direct = await q()
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .include({ p: { comments: { where: (c) => c.text.neq('nice!') } } })
      .where((t) => t.u.name.eq('Alice'))
      .select((t) => [t.p.title])
      .go();
    const c = q()
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .include({ p: { comments: { where: (c) => c.text.neq(slot('name')) } } })
      .where((t) => t.u.name.eq('Alice'))
      .select((t) => [t.p.title])
      .compile<{ name: string }>();
    const viaRun = await h.orm.run(c).fill({ name: 'nice!' }).go();

    expectSameRows(viaRun, direct);
    expect(viaRun.map((r) => r.p.title).sort()).toEqual([
      'Draft Post',
      'Hello Postgres',
    ]);
  });

  it('groupBy + aggregate + typed-слот в where — parity', async () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.views,
    ]);
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const base = () =>
      q()
        .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
        .groupBy((t) => [t.u.name])
        .order((t) => [t.u.name.asc]);
    const direct = await base()
      .where((t) => t.p.views.gte(5))
      .select((t, { agg }) => [t.u.name, agg.sum(t.p.views).as('total')])
      .go();
    const c = base()
      .where((t) => t.p.views.gte(S.slot('views')))
      .select((t, { agg }) => [t.u.name, agg.sum(t.p.views).as('total')])
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ views: 5 }).go();

    expectSameRows(viaRun, direct);
    expect(viaRun.map((r) => r.u.name)).toEqual(['Alice', 'Bob']);
  });

  it('один compiled переиспользуется в цикле с разными значениями', async () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.views,
    ]);
    const c = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.p.views.gt(S.slot('views')))
      .select((t) => [t.p.title])
      .compile(S);
    const runner = h.orm.run(c);

    const high = await runner.fill({ views: 7 }).go();
    const low = await runner.fill({ views: 0 }).go();

    expect(high.map((r) => r.p.title)).toEqual(['Hello Postgres']);
    expect(low.map((r) => r.p.title).sort()).toEqual([
      'Bob Writes',
      'Hello Postgres',
    ]);
  });

  it('3 таблицы (comment→post→user) + typed-слот — parity', async () => {
    const aliceId = seedData.alice.id as number;
    const S = new MultiQuerySlots({
      c: CommentModel,
      p: PostModel,
      a: UserModel,
    }).push((t) => [t.a.id]);
    const q = () => h.orm.query({ c: CommentModel, p: PostModel, a: UserModel });
    const joins = (b: ReturnType<typeof q>) =>
      b
        .join({ left: 'c', right: 'p', on: (t) => t.c.post.eq(t.p.id) })
        .join({ left: 'c', right: 'a', on: (t) => t.c.user.eq(t.a.id) });
    const direct = await joins(q())
      .where((t) => t.a.id.eq(aliceId))
      .select((t) => [t.p.title, t.c.text])
      .go();
    const c = joins(q())
      .where((t) => t.a.id.eq(S.slot('id')))
      .select((t) => [t.p.title, t.c.text])
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ id: aliceId }).go();

    expectSameRows(viaRun, direct);
    expect(viaRun).toHaveLength(1);
    expect(viaRun[0].c.text).toBe('nice!');
  });
});
