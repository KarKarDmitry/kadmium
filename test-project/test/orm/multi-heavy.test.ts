import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
  // Carol — без постов; дополнительно пост без автора (author null)
  const orphan = await h.orm
    .single(PostModel)
    .create({
      title: 'Unclaimed Post',
      content: 'no author',
      published: false,
      views: 7,
      author: null,
    })
    .go();
  expect(orphan.id).toBeDefined();
});

afterAll(async () => {
  await h.adapter.end();
});

describe('multi: heavy joins', () => {
  it('inner join excludes users without posts and posts without authors', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .order((t) => [t.p.title.asc])
      .select((t) => [t.u.name, t.p.title])
      .go();
    expect(rows).toHaveLength(3); // Alice×2, Bob×1 — ни Carol, ни Unclaimed
    expect(rows.some((r) => r.p.title === 'Unclaimed Post')).toBe(false);
    expect(rows.some((r) => r.u.name === 'Carol')).toBe(false);
  });

  it('left join keeps users without posts (null right side)', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({
        left: 'u',
        right: 'p',
        direction: 'left',
        on: (t) => t.u.id.eq(t.p.author),
      })
      .order((t) => [t.u.name.asc])
      .select((t) => [t.u.name, t.p.title])
      .go();
    const carolRow = rows.find((r) => r.u.name === 'Carol');
    expect(carolRow).toBeDefined();
    expect(carolRow!.p.title).toBeNull();
    expect(rows).toHaveLength(4); // Alice×2 + Bob×1 + Carol×1
  });

  it('right join keeps posts without authors (null left side)', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({
        left: 'u',
        right: 'p',
        direction: 'right',
        on: (t) => t.u.id.eq(t.p.author),
      })
      .order((t) => [t.p.title.asc])
      .select((t) => [t.u.name, t.p.title])
      .go();
    const orphanRow = rows.find((r) => r.p.title === 'Unclaimed Post');
    expect(orphanRow).toBeDefined();
    expect(orphanRow!.u.name).toBeNull();
    expect(rows).toHaveLength(4); // posts 3 + orphan, no Carol
  });

  it('outer join keeps both sides (users without posts and posts without authors)', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({
        left: 'u',
        right: 'p',
        direction: 'outer',
        on: (t) => t.u.id.eq(t.p.author),
      })
      .order((t) => [t.p.title.asc])
      .select((t) => [t.u.name, t.p.title])
      .go();
    const carolRow = rows.find((r) => r.u.name === 'Carol');
    const orphanRow = rows.find((r) => r.p.title === 'Unclaimed Post');
    expect(carolRow!.p.title).toBeNull();
    expect(orphanRow!.u.name).toBeNull();
    expect(rows).toHaveLength(5);
  });

  it('where on both aliases intersects join results', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.u.name.eq('Alice'))
      .where((t) => t.p.published.eq(true))
      .select((t) => [t.p.title])
      .go();
    expect(rows).toHaveLength(1);
    expect(rows[0].p.title).toBe('Hello Postgres');
  });

  it('order + limit + offset respects the order alias of the right table', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .order((t) => [t.p.views.desc])
      .limit(2)
      .select((t) => [t.p.title, t.p.views])
      .go();
    expect(rows.map((r) => r.p.views)).toEqual([10, 5]);
  });

  it('groupBy + count + count-over in a joined multi query', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .groupBy((t) => [t.u.name])
      .order((t) => [t.u.name.asc])
      .select((t, { agg }) => [
        t.u.name,
        agg.count(t.p.id).as('posts'),
        agg.sum(t.p.views).as('viewsTotal'),
        agg.count('*').over().as('groups'),
      ])
      .go();
    expect(rows).toHaveLength(2); // Alice, Bob
    expect(rows.find((r) => r.u.name === 'Alice')!.posts).toBe(2);
    expect(rows.find((r) => r.u.name === 'Alice')!.viewsTotal).toBe(10);
    expect(rows.find((r) => r.u.name === 'Bob')!.posts).toBe(1);
    expect(rows.find((r) => r.u.name === 'Bob')!.viewsTotal).toBe(5);
    // окно на строку: обе строки видят обе группы
    expect(rows.map((r) => r.groups)).toEqual([2, 2]);
  });

  it('include works inside a multi query', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .include({
        p: {
          comments: {
            where: (c) => c.text.neq(''),
          },
        },
      })
      .where((t) => t.u.name.eq('Alice'))
      .select((t) => [t.p.title])
      .go();
    expect(rows).toHaveLength(2);
    const withComments = rows.filter((r) => r.p.comments.length > 0);
    expect(withComments).toHaveLength(1); // только Hello Postgres
    expect(withComments[0].p.comments[0].text).toBe('nice!');
  });
});
