import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';
import {
  QuerySlots,
  SelectableField,
  sql,
  slot,
} from '@karkardmitry/kadmium-core';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seed = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('select API: entry point', () => {
  it('orm.select(Model).go() returns all fields by default', async () => {
    const rows = await h.orm.select(UserModel).go();
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['active', 'age', 'email', 'id', 'name', 'registeredAt'].sort(),
    );
  });

  it('select() reads while single() also writes — entries are separate', () => {
    // DML на select-поверхности отсутствует: компилятор ловит это
    // раньше рантайма. Это ключевое отличие от single().
    // @ts-expect-error update() не существует на select-API
    expect(h.orm.select(UserModel).update).toBeUndefined();
    // @ts-expect-error delete() не существует на select-API
    expect(h.orm.select(UserModel).delete).toBeUndefined();
    // @ts-expect-error create() не существует на select-API
    expect(h.orm.select(UserModel).create).toBeUndefined();
    // @ts-expect-error select() переименован в fields()
    expect(h.orm.select(UserModel).select).toBeUndefined();
  });
});

describe('select API: fields() projection', () => {
  it('fields(fn) returns only the projected columns', async () => {
    const rows = await h.orm
      .select(UserModel)
      .fields((u) => [u.id, u.name])
      .go();
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'name']);
  });

  it('fields(array) accepts a ready-made list of selectables', async () => {
    const registeredAt = new SelectableField('User', 'registeredAt');
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields([sql<number>`EXTRACT(YEAR FROM ${registeredAt})::int`.as('year')])
      .go();
    expect(rows).toEqual([{ year: 2024 }]);
  });

  it('fields() with no args restores the full-row projection', async () => {
    const rows = await h.orm
      .select(UserModel)
      .fields((u) => [u.id])
      .fields()
      .where((u) => u.name.eq('Bob'))
      .go();
    expect(Object.keys(rows[0])).toContain('email');
  });

  it('fields() with .as() uses the alias as the result key', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields((u) => [u.age.as('years')])
      .go();
    expect(rows).toEqual([{ years: 30 }]);
  });

  it('fields(fn) exposes aggregates through tools.agg', async () => {
    const rows = await h.orm
      .select(PostModel)
      .fields((p, { agg }) => [agg.count('*').as('total')])
      .go();
    expect(rows).toEqual([{ total: 3 }]);
  });
});

describe('select API: where / order / pagination', () => {
  it('where() filters rows', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.age.gt(26))
      .go();
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('and() / or() chain predicates', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.age.gt(20))
      .and((u) => u.active.eq(true))
      .go();
    // alice (30, active) и carol (40, active) — bob активен лишь формально,
    // но age 25 > 20 и active false, поэтому в выборку не попадает.
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('or() widens the match set', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Bob'))
      .or((u) => u.name.eq('Carol'))
      .go();
    expect(rows.map((r) => r.name).sort()).toEqual(['Bob', 'Carol']);
  });

  it('order() + limit() + offset() paginates', async () => {
    const rows = await h.orm
      .select(UserModel)
      .order((u) => [u.name.desc])
      .limit(2)
      .offset(1)
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Bob', 'Alice']);
  });

  it('page(page, size) maps to limit/offset', async () => {
    const rows = await h.orm
      .select(UserModel)
      .order((u) => [u.name.asc])
      .page(2, 1)
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Bob']);
  });

  it('cursor() continues after a key position', async () => {
    const rows = await h.orm
      .select(UserModel)
      .order((u) => [u.name.asc])
      .cursor((u) => u.name.gt('Alice'))
      .go();
    expect(rows.map((r) => r.name)).toEqual(['Bob', 'Carol']);
  });

  it('cursor() without order() throws', () => {
    expect(() => h.orm.select(UserModel).cursor((u) => u.name.gt('A'))).toThrow(
      /requires an order/,
    );
  });
});

describe('select API: first / count / exists', () => {
  it('first() returns a single row, not an array', async () => {
    const row = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Carol'))
      .first()
      .go();
    expect(row).toMatchObject({ name: 'Carol' });
    expect(Array.isArray(row)).toBe(false);
  });

  it('first() returns undefined when nothing matches', async () => {
    const row = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Nobody'))
      .first()
      .go();
    expect(row).toBeUndefined();
  });

  it('first() applies limit=1 and keeps the first row of the order', async () => {
    const rows = await h.orm
      .select(UserModel)
      .order((u) => [u.name.asc])
      .go();
    const one = await h.orm
      .select(UserModel)
      .order((u) => [u.name.asc])
      .first()
      .go();
    expect(rows.length).toBe(3);
    expect(one).toEqual(rows[0]);
  });

  it('count() counts all rows under the filter', async () => {
    expect(await h.orm.select(UserModel).count().go()).toBe(3);
    // alice и carol активны.
    expect(
      await h.orm
        .select(UserModel)
        .where((u) => u.active.eq(true))
        .count()
        .go(),
    ).toBe(2);
  });

  it('S2: count() ignores limit/offset', async () => {
    const n = await h.orm.select(UserModel).limit(1).offset(2).count().go();
    expect(n).toBe(3);
  });

  it('S3: exists() ignores offset', async () => {
    const found = await h.orm
      .select(UserModel)
      .order((u) => [u.name.asc])
      .offset(2)
      .exists()
      .go();
    expect(found).toBe(true);
  });

  it('exists() is false when the filter matches nothing', async () => {
    expect(
      await h.orm
        .select(UserModel)
        .where((u) => u.name.eq('Nobody'))
        .exists()
        .go(),
    ).toBe(false);
  });
});

describe('select API: groupBy / having', () => {
  it('groupBy() + having() filters aggregate groups', async () => {
    // fields() обязан идти ДО having(): алиасы агрегатов берутся
    // из текущего select, иначе `total` не будет допустимым ключом.
    const rows = await h.orm
      .select(UserModel)
      .fields((u, { agg }) => [u.active, agg.count('*').as('total')])
      .groupBy((u) => [u.active])
      .having((h) => h.total.gt(1))
      .order((u) => [u.active.desc])
      .go();
    // alice + carol активны (2), bob — нет (1). having(total > 1) оставляет один.
    expect(rows).toEqual([{ active: true, total: 2 }]);
  });
});

describe('select API: include', () => {
  it('include({ rel: true }) nests related rows', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: true })
      .go();
    expect(rows[0].posts).toHaveLength(2);
  });

  it('include({ rel: { where } }) filters the nested collection', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: { where: (p) => p.published.eq(true) } })
      .go();
    // у alice два поста: 'Hello Postgres' (published) и 'Draft Post' (нет).
    expect(rows[0].posts).toHaveLength(1);
    expect(rows[0].posts[0].title).toBe('Hello Postgres');
  });

  it('include({ rel: { order, limit } }) shapes the nested collection', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: { limit: 1 } })
      .go();
    expect(rows[0].posts).toHaveLength(1);
  });

  it('include() combines with fields() projection', async () => {
    const rows = await h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields((u) => [u.id, u.name])
      .include({ posts: true })
      .go();
    expect(Object.keys(rows[0]).sort()).toEqual(['id', 'name', 'posts']);
  });
});

describe('select API: clone()', () => {
  it('clone() does not mutate the source builder', async () => {
    const base = h.orm.select(UserModel).where((u) => u.active.eq(true));
    const narrowed = await base
      .clone()
      .where((u) => u.name.eq('Bob'))
      .go();
    const untouched = await base.go();
    // сужение добавлено только в клоне; bob неактивен, поэтому narrowed пуст.
    expect(narrowed).toHaveLength(0);
    // источник не тронут: alice + carol.
    expect(untouched).toHaveLength(2);
  });
});

describe('select API: compile()', () => {
  it('compile() renders parameterized SQL without string interpolation', async () => {
    const c = h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .fields((u) => [u.id]);
    expect(c.compile().text).toContain('$1');
    expect(c.compile().text).not.toContain("'Alice'");
    expect(c.compile().values).toEqual(['Alice']);
  });

  it('compile() + run().fill().go() reuses one render for many values', async () => {
    // User.name — nullable, поэтому плоский путь: slot() + compile<{...}>().
    const c = h.orm
      .select(UserModel)
      .where((u) => u.name.eq(slot('name')))
      .fields((u) => [u.id, u.name])
      .compile<{ name: string }>();
    expect(c.text).toContain('$1');

    const alice = await h.orm.run(c).fill({ name: 'Alice' }).go();
    const bob = await h.orm.run(c).fill({ name: 'Bob' }).go();
    expect(alice).toEqual([{ id: seed.alice.id, name: 'Alice' }]);
    expect(bob).toEqual([{ id: seed.bob.id, name: 'Bob' }]);
  });

  it('typed slots work on a non-null field', async () => {
    // Post.published — notNull, поэтому QuerySlots даёт типизированный слот.
    const S = new QuerySlots(PostModel).push((p) => [p.published]);
    const c = h.orm
      .select(PostModel)
      .where((p) => p.published.eq(S.slot('published')))
      .fields((p) => [p.id])
      .compile(S);
    const published = await h.orm.run(c).fill({ published: true }).go();
    const drafts = await h.orm.run(c).fill({ published: false }).go();
    // p1 'Hello Postgres' и p3 'Bob Writes' опубликованы, p2 'Draft Post' — нет.
    expect(published).toHaveLength(2);
    expect(drafts).toHaveLength(1);
  });

  it('first().compile() marks single=true and renders LIMIT as a parameter', () => {
    const c = h.orm
      .select(UserModel)
      .where((u) => u.name.eq('Alice'))
      .first()
      .compile();
    expect(c.single).toBe(true);
    // LIMIT рендерится параметром ($N), а не литералом — правило адаптера.
    expect(c.text).toMatch(/LIMIT \$\d+/);
    expect(c.text).not.toContain('LIMIT 1');
  });
});
