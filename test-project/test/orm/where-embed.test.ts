import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { or, sql, QuerySlots } from '@karkardmitry/kadmium-core';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed, type SeedData } from '../fixtures';

let h: Harness;
let seedData: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seedData = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('where — sql-фрагмент в WHERE против PG (E)', () => {
  it('одиночный фрагмент без скобок + параметр', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where(() => sql`"User"."age" > ${25}`)
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Carol']);
  });

  it('P1: AND-сосед + OR-внутри-фрагмента → фрагмент в скобках', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.active.eq(true))
      .and(() => sql`"User"."age" = ${25} OR "User"."age" = ${40}`)
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Carol']);
  });

  it('типизированное поле через proxy ($ {t.field})', async () => {
    const rows = await h.orm
      .single(PostModel)
      .where((p) => sql`${p.views} >= ${5}`)
      .select((p) => [p.title])
      .go();
    expect(rows.map((r) => r.title).sort()).toEqual([
      'Bob Writes',
      'Hello Postgres',
    ]);
  });

  it('ILIKE во фрагменте', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => sql`${u.name} ILIKE ${'a%'}`)
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Alice']);
  });

  it('каст/функция во фрагменте: EXTRACT(MONTH FROM ...)', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => sql`EXTRACT(MONTH FROM ${u.registeredAt}) = ${2}`)
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Bob']);
  });

  it('коррелированный EXISTS с параметром внутри фрагмента', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where(
        () =>
          sql`EXISTS (SELECT 1 FROM "post" p_hot WHERE p_hot."author" = "User"."id" AND p_hot."views" > ${5})`,
      )
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Alice']);
  });

  it('or()-выражение с фрагментом и условием', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) =>
        or(sql`"User"."name" = ${'Alice'}`, u.email.eq('bob@test.com')),
      )
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('and-цепочка через .and() с фрагментом', async () => {
    const rows = await h.orm
      .single(UserModel)
      .where((u) => u.active.eq(true))
      .and(() => sql`"User"."age" = ${40}`)
      .select((t) => [t.name])
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Carol']);
  });

  it('include: where-фрагмент внутри LATERAL-подзапроса', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({
        posts: {
          where: (p) => sql`${p.published} = ${true}`,
          select: (p) => [p.title],
        },
      })
      .first()
      .go();
    const titles = (alice?.posts ?? []).map((p) => p.title);
    expect(titles).toEqual(['Hello Postgres']);
  });

  it('multi: фрагмент по алиасу другой таблицы', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where(() => sql`"u"."name" = ${'Alice'}`)
      .select((t) => [t.p.title])
      .go();
    expect(rows.map((r) => r.p.title).sort()).toEqual([
      'Draft Post',
      'Hello Postgres',
    ]);
  });

  it('count().where(фрагмент)', async () => {
    const n = await h.orm
      .single(UserModel)
      .where(() => sql`"User"."age" >= ${30}`)
      .count()
      .go();
    expect(n).toBe(2);
  });

  it('having: фрагмент с COUNT(*) и параметром', async () => {
    const rows = await h.orm
      .single(PostModel)
      .select((p, { agg }) => [p.author, agg.count('*').as('cnt')])
      .groupBy((p) => [p.author])
      .having(() => sql`COUNT(*) > ${1}`)
      .go();
    expect(rows.length).toBe(1);
    expect(rows[0].cnt).toBe(2);
  });

  it('typed-слот внутри where-фрагмента: compile(S) + fill', async () => {
    const id = seedData.bob.id as number;
    const S = new QuerySlots(UserModel).push((u) => [u.id]);
    const direct = await h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where((u) => u.id.eq(id))
      .go();
    const c = h.orm
      .single(UserModel)
      .select((u) => [u.id, u.name])
      .where(() => sql`"User"."id" = ${S.slot('id')}`)
      .compile(S);
    const viaRun = await h.orm.run(c).fill({ id }).go();
    expect(viaRun).toEqual(direct);
    expect(viaRun?.[0]?.name).toBe('Bob');
  });

  it('update().where(фрагмент) применяет фильтр', async () => {
    const res = await h.orm
      .single(UserModel)
      .update({ active: false })
      .where(() => sql`"User"."name" = ${'Carol'}`)
      .go();
    expect(res).toHaveLength(1);
    expect(res[0].active).toBe(false);
  });
});
