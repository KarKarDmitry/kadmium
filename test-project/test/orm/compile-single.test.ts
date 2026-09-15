import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { QuerySlots, slot } from '@karkardmitry/kadmium-core';
import type { CompiledQuery } from '@karkardmitry/kadmium-sql-types';
import { User as UserModel, Post as PostModel } from '../../src/models';
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

describe('single: go() vs run(compile()).fill().go()', () => {
  it('базовое WHERE по статусу (typed-слот boolean) — оба канала дают одинаковые строки', async () => {
    const direct = await h.orm
      .single(PostModel)
      .select((p) => [p.id, p.published])
      .where((p) => p.published.eq(true))
      .go();
    const S = new QuerySlots(PostModel).push((p) => [p.published]);
    const c = h.orm
      .single(PostModel)
      .select((p) => [p.id, p.published])
      .where((p) => p.published.eq(S.slot('published')))
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ published: true }).go();

    expect(viaRun).toEqual(direct);
    expect(c.text).toContain('$1');
    expect(c.text).not.toContain('true'); // значения — только параметры, не интерполяция
    expect(viaRun).toHaveLength(2);
  });

  it('два typed-слота разных типов (bool + число) в AND-цепочке', async () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published, p.views]);
    const direct = await h.orm
      .single(PostModel)
      .select((p) => [p.id, p.title])
      .where((p) => p.published.eq(true))
      .where((p) => p.views.gt(7))
      .go();
    const c = h.orm
      .single(PostModel)
      .select((p) => [p.id, p.title])
      .where((p) => p.published.eq(S.slot('published')))
      .where((p) => p.views.gt(S.slot('views')))
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ published: true, views: 7 }).go();

    expectSameRows(viaRun, direct);
    expect(viaRun.map((r) => r.title).sort()).toEqual(['Hello Postgres']);
  });

  it('first() по id (typed-слот) — объект|undefined, TResult миррорит go()', async () => {
    const id = seedData.alice.id as number;
    const S = new QuerySlots(UserModel).push((u) => [u.id]);
    const direct = await h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.id.eq(id))
      .first()
      .go();
    const c = h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.id.eq(S.slot('id')))
      .first()
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ id }).go();

    expect(viaRun).toEqual(direct);
    expect(viaRun?.name).toBe('Alice');
  });

  it('IN по массиву-слоту (.array.as("ids")) на непустом pk', async () => {
    const ids = [seedData.alice.id as number, seedData.bob.id as number];
    const S = new QuerySlots(UserModel).push((u) => [u.id.array.as('ids')]);
    const direct = await h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.id.in(ids))
      .go();
    const c = h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.id.in(S.slot('ids')))
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ ids }).go();

    expectSameRows(viaRun, direct);
    expect(viaRun.map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('include (вложенные posts) — reshape через sqb-снапшот не ломает форму', async () => {
    const id = seedData.alice.id as number;
    const S = new QuerySlots(UserModel).push((u) => [u.id]);
    const direct = await h.orm
      .single(UserModel)
      .where((u) => u.id.eq(id))
      .include({ posts: true })
      .go();
    const c = h.orm
      .single(UserModel)
      .where((u) => u.id.eq(S.slot('id')))
      .include({ posts: true })
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ id }).go();

    expect(viaRun).toEqual(direct);
    expect(viaRun).toHaveLength(1);
    const alice = viaRun[0];
    expect(alice.posts.map((p) => p.title).sort()).toEqual([
      'Draft Post',
      'Hello Postgres',
    ]);
  });

  it('order + page с одним слотом — одинаковый порядок и пагинация', async () => {
    const S = new QuerySlots(PostModel).push((p) => [p.views]);
    const direct = await h.orm
      .single(PostModel)
      .select((p) => [p.id, p.views])
      .where((p) => p.views.gt(0))
      .order((p) => [p.views.desc])
      .page(1, 2)
      .go();
    const c = h.orm
      .single(PostModel)
      .select((p) => [p.id, p.views])
      .where((p) => p.views.gt(S.slot('views')))
      .order((p) => [p.views.desc])
      .page(1, 2)
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ views: 0 }).go();

    expect(viaRun).toEqual(direct);
    expect(viaRun.map((r) => r.views)).toEqual([10, 5]);
  });

  it('типизированный compile(S): TSlots = ToDef<S>, TResult = результат go()', () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published, p.views]);
    const b = h.orm
      .single(PostModel)
      .select((p) => [p.id])
      .where((p) => p.published.eq(S.slot('published')));
    type R = Awaited<ReturnType<typeof b.go>>;
    const c = b.compile(S);
    const e: Equal<
      typeof c,
      CompiledQuery<{ published: boolean; views: number }, R>
    > = true;
    expect(e).toBe(true);
  });

  it('fill: лишний ключ и недостающий ключ бросают (strict-валидация)', () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published]);
    const c = h.orm
      .single(PostModel)
      .where((p) => p.published.eq(S.slot('published')))
      .compile(S);
    const runner = h.orm.run(c);
    expect(() => runner.fill({ published: true, ghost: 1 } as never)).toThrow(
      /Unknown slot key\(s\): ghost/,
    );
    expect(() => runner.fill({} as never)).toThrow(
      /Missing slot value\(s\): published/,
    );
  });

  it('плоский путь: flat compile<T>() + core slot("name") — тот же результат, что go()', async () => {
    const direct = await h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.name.eq('Alice'))
      .go();
    const c = h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.name.eq(slot('name')))
      .compile<{ name: string | undefined }>();
    const runner = h.orm.run(c);
    expect(runner.fill({ name: 'Alice' }).sql()).toContain('$1');
    const viaRun = await runner.fill({ name: 'Alice' }).go();

    expect(viaRun).toEqual(direct);
  });

  it('один compiled-запрос переиспользуется в цикле с разными fill — все равны go()', async () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published]);
    const c = h.orm
      .single(PostModel)
      .select((p) => [p.id, p.published])
      .where((p) => p.published.eq(S.slot('published')))
      .compile(S);
    const before = c.text;

    for (const published of [true, false]) {
      const direct = await h.orm
        .single(PostModel)
        .select((p) => [p.id, p.published])
        .where((p) => p.published.eq(published))
        .go();
      const viaRun = await h.orm.run(c).fill({ published }).go();
      expect(viaRun).toEqual(direct);
      // текст запроса неизменен между fill — значения только в параметрах
      expect(c.text).toBe(before);
    }
  });

  it('run() внутри transaction() — маршрутизация на tx-адаптер, результат как go()', async () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published]);
    const direct = await h.orm
      .single(PostModel)
      .select((p) => [p.id])
      .where((p) => p.published.eq(true))
      .go();
    const c = h.orm
      .single(PostModel)
      .select((p) => [p.id])
      .where((p) => p.published.eq(S.slot('published')))
      .compile(S);

    await h.orm.transaction(async (tx) => {
      const viaRun = await tx.run(c).fill({ published: true }).go();
      expectSameRows(viaRun, direct);
    });
  });
});
