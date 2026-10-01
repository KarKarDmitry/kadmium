import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { MultiQuerySlots, or, sql } from '@karkardmitry/kadmium-core';
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

// sql-фрагменты в join().on (C): рендер + runtime parity
describe('sql-фрагменты в join().on', () => {
  it('raw-фрагмент в on — эквивалент условия, параметры целы', async () => {
    const q = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => sql`${t.u.id} = ${t.p.author}`,
      })
      .fields((t) => [t.p.title]);

    expect(q.toSql()).toContain('ON "u"."id" = "p"."author"');

    const rows = await q.go();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.p.title).sort()).toEqual([
      'Bob Writes',
      'Draft Post',
      'Hello Postgres',
    ]);
  });

  it('or()-группа в on — комбинируется без скобок, runtime OR', async () => {
    const q = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({
        left: 'u',
        right: 'p',
        on: (t) => or(t.u.id.eq(t.p.author), t.u.active.eq(false)),
      })
      .fields((t) => [t.p.title]);

    expect(q.toSql()).toContain('OR "u"."active"');

    const rows = await q.go();
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.p.title).sort()).toEqual([
      'Bob Writes',
      'Draft Post',
      'Draft Post',
      'Hello Postgres',
      'Hello Postgres',
    ]);
  });

  it('слот в on-фрагменте: compile(S) + fill — parity с прямым где', async () => {
    const S = new MultiQuerySlots({ u: UserModel, p: PostModel }).push((t) => [
      t.p.published,
    ]);
    const base = (withSlot: boolean) =>
      h.orm.query({ u: UserModel, p: PostModel }).join({
        left: 'u',
        right: 'p',
        on: (t) =>
          sql`${t.u.id} = ${t.p.author} AND ${t.p.published} = ${
            withSlot ? S.slot('published') : true
          }`,
      });

    const direct = await base(false)
      .where((t) => t.p.published.eq(true))
      .fields((t) => [t.p.title])
      .go();
    const c = base(true)
      .fields((t) => [t.p.title])
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ published: true }).go();

    expect(viaRun).toEqual(direct);
    expect(viaRun.map((r) => r.p.title).sort()).toEqual([
      'Bob Writes',
      'Hello Postgres',
    ]);
  });
});

// groupBy-шаги: алиас не-главной таблицы + sql-выражение
describe('groupBy-шаги', () => {
  it('groupBy на поле не-главной таблицы рендерит её алиас (регрессия)', async () => {
    const q = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .groupBy((t) => [t.p.author])
      .order((t) => [t.p.author.asc])
      .fields((t, { agg }) => [t.p.author, agg.count('*').as('cnt')]);

    const text = q.toSql();
    expect(text).toContain('GROUP BY "p"."author"');
    expect(text).not.toContain('GROUP BY "u"."author"');

    const rows = await q.go();
    expect(rows.map((r) => r.cnt)).toEqual([2, 1]);
  });

  it('groupBy на sql-выражении: выражение и параметр в GROUP BY', async () => {
    const q = h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .groupBy((t) => [sql`date_part(${'month'}, ${t.u.registeredAt})`])
      .fields((t, { agg }) => [agg.count('*').as('cnt')]);

    expect(q.toSql()).toContain('GROUP BY date_part($1, "u"."registeredAt")');

    const rows = await q.go();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.cnt)).toEqual([2, 1]);
  });
});
