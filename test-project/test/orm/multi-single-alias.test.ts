import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../src/models';
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

// one-алиасный multi (query({ u })) всегда вложен под алиас.
// Раньше рантайм отдавал плоские строки ('u.name'), а тип обещал { u }.
describe('multi single-alias: обязательный reshape', () => {
  it('select+where+order — поля вложены под алиас', async () => {
    const q = h.orm
      .query({ u: UserModel })
      .where((t) => t.u.active.eq(true))
      .order((t) => [t.u.age.desc])
      .select((t) => [t.u.name, t.u.age]);

    const text = q.toSql();
    expect(text).toContain('"u"."name" AS "u.name"');
    expect(text).toContain('"u"."age" AS "u.age"');

    const rows = await q.go();
    expect(rows).toEqual([
      { u: { name: 'Carol', age: 40 } },
      { u: { name: 'Alice', age: 30 } },
    ]);
  });

  it('include под алиасом внутри single-alias multi', async () => {
    const rows = await h.orm
      .query({ u: UserModel })
      .where((t) => t.u.name.eq('Alice'))
      .include({ u: { posts: { select: (p) => [p.title] } } })
      .select((t) => [t.u.name])
      .go();

    expect(rows).toEqual([
      {
        u: {
          name: 'Alice',
          posts: [{ title: 'Hello Postgres' }, { title: 'Draft Post' }],
        },
      },
    ]);
  });

  it('groupBy+aggregate: group-поля вложены, агрегат на корне', async () => {
    const rows = await h.orm
      .query({ u: UserModel })
      .groupBy((t) => [t.u.active])
      .order((t) => [t.u.active.asc])
      .select((t, { agg }) => [t.u.active, agg.count('*').as('cnt')])
      .go();

    expect(rows).toEqual([
      { u: { active: false }, cnt: 1 },
      { u: { active: true }, cnt: 2 },
    ]);
  });
});