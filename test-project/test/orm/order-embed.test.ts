import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql } from '@karkardmitry/kadmium-core';
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

describe('order — sql-фрагмент в ORDER BY против PG', () => {
  it('ORDER BY фрагментом с арифметикой и направлением', async () => {
    // ages: Alice=30, Bob=25, Carol=40 → age*2: 60, 50, 80
    const rows = await h.orm
      .single(UserModel)
      .select((t) => [t.name])
      .order((t) => [sql<number>`("User"."age" * 2)`.desc])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Carol', 'Alice', 'Bob']);
  });

  it('фрагмент с параметром сдвигается как единый $N', async () => {
    // age >= 25 → Alice(30) Carol(40) Bob(25), ORDER BY (age + 100) — 130,140,125
    const rows = await h.orm
      .single(UserModel)
      .where((t) => t.active.eq(true))
      .select((t) => [t.name])
      .order((t) => [sql<number>`("User"."age" + ${100})`.asc])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Carol']);
  });

  it('смесь колонки и фрагмента', async () => {
    // active DESC => true первыми: Alice(30,%3=0), Carol(40,%3=1); active=false → Bob последним
    const rows = await h.orm
      .single(UserModel)
      .select((t) => [t.name])
      .order((t) => [
        t.active.desc,
        sql<number>`("User"."age" % 3)`.asc,
        t.name.asc,
      ])
      .go();
    const a = rows.map((r) => r.name);
    expect(a).toEqual(['Alice', 'Carol', 'Bob']);
  });

  it('include: order фрагментом внутри LATERAL-подзапроса', async () => {
    // посты Alice: p1 views=10, p2 views=0 → (views + 1) DESC → p1,p2
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({
        posts: {
          order: (p) => [sql<number>`("posts"."views" + ${1})`.desc],
          select: (p) => [p.title],
        },
      })
      .first()
      .go();
    const posts = alice?.posts ?? [];
    expect(posts.map((p) => p.title)).toEqual(['Hello Postgres', 'Draft Post']);
  });

  it('multi: ORDER BY фрагментом по полю другой таблицы', async () => {
    // posts sorted by (views * 2) desc: p1(20), p3(10), p2(0)
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .order((t) => [sql<number>`("p"."views" * ${2})`.desc])
      .select((t) => [t.p.title])
      .go();
    expect(rows.map((r) => r.p.title)).toEqual([
      'Hello Postgres',
      'Bob Writes',
      'Draft Post',
    ]);
  });
});
