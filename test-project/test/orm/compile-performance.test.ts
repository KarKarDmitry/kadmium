import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AppCore,
  Model,
  MultiQuerySlots,
  OrmManager,
  QuerySlots,
  slot,
} from '@karkardmitry/kadmium-core';
import { createDebugAdapter } from '@karkardmitry/kadmium-sql-pg';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../../src/models';

/**
 * Рендер-сравнение (без запроса к БД): обычный билдер пересчитывает SQL
 * при КАЖДОМ использовании (clone + materialize + adapter.toSql), а
 * скомпилированный запрос рендерит ОДИН раз (compile) и дальше только
 * подставляет значения в params через fill().
 *
 * Адаптер — createDebugAdapter(): настоящий sql-pg рендер без соединения.
 * Счётчик renderCount оборачивает toSql, чтобы честно посчитать рендеры.
 */

const ITERS = 800;
/** Прогрев JIT/инлайн-кэша до замера — рендеры не считаются. */
const WARMUP = ITERS;

function makeHarness() {
  const base = createDebugAdapter();
  let renderCount = 0;
  const adapter = {
    ...base,
    toSql: (sqb: Parameters<(typeof base)['toSql']>[0]) => {
      renderCount++;
      return base.toSql(sqb);
    },
  };
  const app = new AppCore();
  app.register([UserModel, PostModel, CommentModel]);
  const orm = new OrmManager(app, adapter);
  return { orm, count: () => renderCount, reset: () => (renderCount = 0) };
}

interface BenchResult {
  buildMs: number;
  compMs: number;
  buildRenders: number;
  compRenders: number;
  previewB: string;
  previewC: string;
}

function benchCase(
  name: string,
  count: () => number,
  reset: () => void,
  build: () => string,
  makeCompiled: () => () => string,
): BenchResult {
  // Warm-up канала билдера вне замера (JIT, полиморфные inline-кэши proxy)
  for (let i = 0; i < WARMUP; i++) build();

  // канал 1 — обычный билдер: N полных рендеров
  reset();
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) build();
  const buildMs = performance.now() - t0;
  const buildRenders = count();

  // Warm-up канала compiled вне замера (compile + fill-подстановки)
  for (let i = 0; i < WARMUP; i++) makeCompiled()();

  // канал 2 — compiled: 1 рендер (compile) + N fill-подстановок
  reset();
  const t1 = performance.now();
  const compiled = makeCompiled();
  for (let i = 0; i < ITERS; i++) compiled();
  const compMs = performance.now() - t1;
  const compRenders = count();

  const previewB = build();
  const previewC = compiled();

  const speedup = (buildMs / Math.max(compMs, 0.001)).toFixed(1);
  console.log(
    `[perf] ${name.padEnd(30)}builder ${buildMs.toFixed(1)}ms (${buildRenders} render) | ` +
      `compiled ${compMs.toFixed(1)}ms (${compRenders} render) | speedup ${speedup}x`,
  );

  return { buildMs, compMs, buildRenders, compRenders, previewB, previewC };
}

describe('render-perf: обычный билдер vs compiled (без запроса к БД)', () => {
  let harness!: ReturnType<typeof makeHarness>;
  let orm!: ReturnType<typeof makeHarness>['orm'];

  beforeEach(() => {
    Model.clear();
    harness = makeHarness();
    orm = harness.orm;
  });

  afterEach(() => Model.clear());

  it('1) eq: один typed-слот boolean — compiled рендерит 1 раз, текст совпадает, быстрее', () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published]);
    const r = benchCase(
      'eq boolean',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(PostModel)
          .select((p) => [p.id, p.published])
          .where((p) => p.published.eq(true))
          .toSql(),
      () => {
        const c = orm
          .single(PostModel)
          .select((p) => [p.id, p.published])
          .where((p) => p.published.eq(S.slot('published')))
          .compile(S);
        return () => orm.run(c).fill({ published: true }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('2) AND: два typed-слота разных типов (bool + число)', () => {
    const S = new QuerySlots(PostModel).push((p) => [p.published, p.views]);
    const r = benchCase(
      'AND bool + number',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(PostModel)
          .select((p) => [p.id, p.title])
          .where((p) => p.published.eq(true))
          .where((p) => p.views.gt(7))
          .toSql(),
      () => {
        const c = orm
          .single(PostModel)
          .select((p) => [p.id, p.title])
          .where((p) => p.published.eq(S.slot('published')))
          .where((p) => p.views.gt(S.slot('views')))
          .compile(S);
        return () => orm.run(c).fill({ published: true, views: 7 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('3) IN по массиву-слоту (.array.as("ids")) — = ANY($N) одним параметром', () => {
    const S = new QuerySlots(UserModel).push((u) => [u.id.array.as('ids')]);
    const r = benchCase(
      'IN array-slot',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(UserModel)
          .select((u) => [u.id, u.name])
          .where((u) => u.id.in([1, 2, 3]))
          .toSql(),
      () => {
        const c = orm
          .single(UserModel)
          .select((u) => [u.id, u.name])
          .where((u) => u.id.in(S.slot('ids')))
          .compile(S);
        return () =>
          orm
            .run(c)
            .fill({ ids: [1, 2, 3] })
            .sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('= ANY($1)');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('4) include (вложенные posts) + слот на id — LATERAL-join не рендерится повторно', () => {
    const S = new QuerySlots(UserModel).push((u) => [u.id]);
    const r = benchCase(
      'include posts',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(UserModel)
          .select((u) => [u.id, u.name])
          .where((u) => u.id.eq(1))
          .include({ posts: true })
          .toSql(),
      () => {
        const c = orm
          .single(UserModel)
          .select((u) => [u.id, u.name])
          .where((u) => u.id.eq(S.slot('id')))
          .include({ posts: true })
          .compile(S);
        return () => orm.run(c).fill({ id: 1 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('LATERAL');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('5) order + limit + слот — пагинация переиспользуется как const', () => {
    const S = new QuerySlots(PostModel).push((p) => [p.views]);
    const r = benchCase(
      'order + limit',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(PostModel)
          .select((p) => [p.id, p.views])
          .where((p) => p.views.gt(0))
          .order((p) => [p.views.desc])
          .limit(5)
          .toSql(),
      () => {
        const c = orm
          .single(PostModel)
          .select((p) => [p.id, p.views])
          .where((p) => p.views.gt(S.slot('views')))
          .order((p) => [p.views.desc])
          .limit(5)
          .compile(S);
        return () => orm.run(c).fill({ views: 0 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('6) first() single-mode — LIMIT 1 прошит, разворачивание rows[0] не ре-рендерит', () => {
    const S = new QuerySlots(PostModel).push((p) => [p.id]);
    const r = benchCase(
      'first() single',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(PostModel)
          .select((p) => [p.id, p.title])
          .where((p) => p.id.eq(3))
          .first()
          .toSql(),
      () => {
        const c = orm
          .single(PostModel)
          .select((p) => [p.id, p.title])
          .where((p) => p.id.eq(S.slot('id')))
          .first()
          .compile(S);
        return () => orm.run(c).fill({ id: 3 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('LIMIT');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('7) flat-путь: core slot("title") на nullable-поле без QuerySlots', () => {
    const r = benchCase(
      'flat slot(title)',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(PostModel)
          .select((p) => [p.id, p.title])
          .where((p) => p.title.eq('Hello Postgres'))
          .toSql(),
      () => {
        const c = orm
          .single(PostModel)
          .select((p) => [p.id, p.title])
          .where((p) => p.title.eq(slot('title')))
          .compile<{ title: string | undefined }>();
        return () => orm.run(c).fill({ title: 'Hello Postgres' }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('$1');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('8) gte + lte: два числовых слота одного типа в диапазоне', () => {
    const S = new QuerySlots(PostModel).push((p) => [
      p.views.as('min'),
      p.views.as('max'),
    ]);
    const r = benchCase(
      'gte + lte range',
      harness.count,
      harness.reset,
      () =>
        orm
          .single(PostModel)
          .select((p) => [p.id, p.views])
          .where((p) => p.views.gte(0))
          .where((p) => p.views.lte(100))
          .toSql(),
      () => {
        const c = orm
          .single(PostModel)
          .select((p) => [p.id, p.views])
          .where((p) => p.views.gte(S.slot('min')))
          .where((p) => p.views.lte(S.slot('max')))
          .compile(S);
        return () => orm.run(c).fill({ min: 0, max: 100 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('9) масштабирование: рост числа where-условий — цена proxy-методов (eq) на условие', () => {
    const sizes = [1, 2, 4, 8];
    const results = new Map<number, BenchResult>();

    for (const n of sizes) {
      const S = new QuerySlots(PostModel).push((p) =>
        Array.from({ length: n }, (_, i) => p.published.as(`f${i}`)),
      );
      const slots = Array.from({ length: n }, (_, i) =>
        S.slot(`f${i}` as `f${number}`),
      );
      const fill: Record<string, boolean> = {};
      for (let i = 0; i < n; i++) fill[`f${i}`] = true;

      results.set(
        n,
        benchCase(
          `where x${n}`,
          harness.count,
          harness.reset,
          () => {
            const q = orm.single(PostModel).select((p) => [p.id]);
            for (let i = 0; i < n; i++) q.where((p) => p.published.eq(true));
            return q.toSql();
          },
          () => {
            const q = orm.single(PostModel).select((p) => [p.id]);
            for (let i = 0; i < n; i++)
              q.where((p) => p.published.eq(slots[i]));
            const c = q.compile(S);
            return () => orm.run(c).fill(fill).sql();
          },
        ),
      );
    }

    for (const n of sizes) {
      const r = results.get(n)!;
      expect(r.buildRenders).toBe(ITERS);
      expect(r.compRenders).toBe(1);
      expect(r.previewC).toBe(r.previewB);
      expect(r.compMs).toBeLessThan(r.buildMs);
    }

    const b1 = results.get(1)!.buildMs;
    const b8 = results.get(8)!.buildMs;
    const c1 = results.get(1)!.compMs;
    const c8 = results.get(8)!.compMs;
    console.log(
      `[perf] proxy scaling: builder ${b1.toFixed(1)}ms (1 cond) -> ${b8.toFixed(1)}ms (8 cond, x${(b8 / b1).toFixed(1)}) | ` +
        `compiled ${c1.toFixed(1)}ms -> ${c8.toFixed(1)}ms (x${(c8 / c1).toFixed(1)})`,
    );

    // Число условий растёт линейно → рендер билдера обязан дорожать; compiled почти не реагирует.
    expect(b8).toBeGreaterThan(b1);
  });

  it('10) multi: join + typed-слот — compiled не пересобирает join-цепочку', () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.published,
    ]);
    const r = benchCase(
      'multi join + slot',
      harness.count,
      harness.reset,
      () =>
        orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .where((t) => t.p.published.eq(true))
          .select((t) => [t.u.name, t.p.title])
          .toSql(),
      () => {
        const c = orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .where((t) => t.p.published.eq(S.slot('published')))
          .select((t) => [t.u.name, t.p.title])
          .compile(S);
        return () => orm.run(c).fill({ published: true }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('JOIN');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('11) multi flat: slot() на nullable-поле — compile<T>() без MultiQuerySlots', () => {
    const r = benchCase(
      'multi flat slot',
      harness.count,
      harness.reset,
      () =>
        orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .where((t) => t.p.title.eq('Hello Postgres'))
          .select((t) => [t.u.name, t.p.title])
          .toSql(),
      () => {
        const c = orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .where((t) => t.p.title.eq(slot('title')))
          .select((t) => [t.u.name, t.p.title])
          .compile<{ title: string | undefined }>();
        return () => orm.run(c).fill({ title: 'Hello Postgres' }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('$1');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('12) multi: order + limit + offset + typed-слот — пагинация переиспользуется', () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.views,
    ]);
    const r = benchCase(
      'multi order+limit',
      harness.count,
      harness.reset,
      () =>
        orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .where((t) => t.p.views.gt(0))
          .order((t) => [t.p.views.desc])
          .limit(5)
          .offset(0)
          .select((t) => [t.u.name, t.p.title])
          .toSql(),
      () => {
        const c = orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .where((t) => t.p.views.gt(S.slot('views')))
          .order((t) => [t.p.views.desc])
          .limit(5)
          .offset(0)
          .select((t) => [t.u.name, t.p.title])
          .compile(S);
        return () => orm.run(c).fill({ views: 0 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('LIMIT');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('13) multi: include (LATERAL) + слот в include().where() — LATERAL не рендерится повторно', () => {
    const r = benchCase(
      'multi include',
      harness.count,
      harness.reset,
      () =>
        orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .include({ p: { comments: { where: (c) => c.text.neq('x') } } })
          .select((t) => [t.p.title])
          .toSql(),
      () => {
        const c = orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .include({ p: { comments: { where: (c) => c.text.neq(slot('text')) } } })
          .select((t) => [t.p.title])
          .compile<{ text: string | undefined }>();
        return () => orm.run(c).fill({ text: 'x' }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('LATERAL');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('14) multi: groupBy + aggregate + typed-слот — группировка не пересобирается', () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.views,
    ]);
    const r = benchCase(
      'multi groupBy agg',
      harness.count,
      harness.reset,
      () =>
        orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .groupBy((t) => [t.u.name])
          .where((t) => t.p.views.gte(5))
          .select((t, { agg }) => [t.u.name, agg.sum(t.p.views).as('total')])
          .toSql(),
      () => {
        const c = orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
          .groupBy((t) => [t.u.name])
          .where((t) => t.p.views.gte(S.slot('views')))
          .select((t, { agg }) => [t.u.name, agg.sum(t.p.views).as('total')])
          .compile(S);
        return () => orm.run(c).fill({ views: 5 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('GROUP BY');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('15) multi: слот в join().on — paramIndex общего рендера не сбрасывается', () => {
    const r = benchCase(
      'multi slot in ON',
      harness.count,
      harness.reset,
      () =>
        orm
          .query({ u: UserModel, p: PostModel })
          .join({ left: 'u', right: 'p', on: (t) => t.p.author.eq(1) })
          .where((t) => t.u.id.eq(t.p.author))
          .select((t) => [t.p.title])
          .toSql(),
      () => {
        const c = orm
          .query({ u: UserModel, p: PostModel })
          .join({
            left: 'u',
            right: 'p',
            on: (t) => t.p.author.eq(slot('author')),
          })
          .where((t) => t.u.id.eq(t.p.author))
          .select((t) => [t.p.title])
          .compile<{ author: number | undefined }>();
        return () => orm.run(c).fill({ author: 1 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('JOIN');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });

  it('16) multi: 3 таблицы (comment→post→user) + typed-слот', () => {
    const S = new MultiQuerySlots({
      c: CommentModel,
      p: PostModel,
      a: UserModel,
    }).push((t) => [t.a.id]);
    const build = () =>
      orm
        .query({ c: CommentModel, p: PostModel, a: UserModel })
        .join({ left: 'c', right: 'p', on: (t) => t.c.post.eq(t.p.id) })
        .join({ left: 'c', right: 'a', on: (t) => t.c.user.eq(t.a.id) })
        .where((t) => t.a.id.eq(1))
        .select((t) => [t.p.title, t.c.text]);
    const r = benchCase(
      'multi 3-table',
      harness.count,
      harness.reset,
      () => build().toSql(),
      () => {
        const c = orm
          .query({ c: CommentModel, p: PostModel, a: UserModel })
          .join({ left: 'c', right: 'p', on: (t) => t.c.post.eq(t.p.id) })
          .join({ left: 'c', right: 'a', on: (t) => t.c.user.eq(t.a.id) })
          .where((t) => t.a.id.eq(S.slot('id')))
          .select((t) => [t.p.title, t.c.text])
          .compile(S);
        return () => orm.run(c).fill({ id: 1 }).sql();
      },
    );

    expect(r.buildRenders).toBe(ITERS);
    expect(r.compRenders).toBe(1);
    expect(r.previewC).toBe(r.previewB);
    expect(r.previewC).toContain('JOIN');
    expect(r.compMs).toBeLessThan(r.buildMs);
  });
});
