import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  User as UserModel,
  Post as PostModel,
  Comment as CommentModel,
} from '../../src/models';
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

describe('multi: joins, groupBy, aggregates', () => {
  it('inner join across two tables', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .select((t) => [t.u.name, t.p.title])
      .go();
    // Alice (2 поста) + Bob (1 пост) = 3
    expect(rows.length).toBe(3);
    const names = rows.map((r) => r.u.name).sort();
    expect(names).toEqual(['Alice', 'Alice', 'Bob']);
  });

  it('where on joined query filters correctly', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .where((t) => t.u.name.eq('Bob'))
      .select((t) => [t.p.title])
      .go();
    expect(rows.length).toBe(1);
    expect(rows[0].p.title).toBe('Bob Writes');
  });

  it('groupBy + count aggregate', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .groupBy((t) => [t.u.name])
      .select((t, { agg }) => [t.u.name, agg.count(t.p.id).as('postCount')])
      .go();
    expect(rows.length).toBe(2);
  });

  it('3-table join (user -> post -> comment)', async () => {
    const rows = await h.orm
      .query({ c: CommentModel, p: PostModel, a: UserModel })
      .join({ left: 'c', right: 'p', on: (t) => t.c.post.eq(t.p.id) })
      .join({ left: 'c', right: 'a', on: (t) => t.c.user.eq(t.a.id) })
      .select((t) => [t.p.title, t.a.name, t.c.text])
      .go();
    expect(rows.length).toBe(3);
  });
});

describe('multi: count/exists/first terminals (M2)', () => {
  const joined = () =>
    h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) });

  it('count() counts all joined rows', async () => {
    const n = await joined().count().go();
    expect(n).toBe(3);
  });

  it('count() ignores limit/offset (S2)', async () => {
    const n = await joined().limit(1).offset(1).count().go();
    expect(n).toBe(3);
  });

  it('exists() is true for a match despite offset (S3)', async () => {
    const yes = await joined()
      .offset(5)
      .where((t) => t.u.name.eq('Bob'))
      .exists()
      .go();
    expect(yes).toBe(true);
  });

  it('exists() is false when nothing matches', async () => {
    const no = await joined()
      .where((t) => t.u.name.eq('Nobody'))
      .exists()
      .go();
    expect(no).toBe(false);
  });

  it('exists() materializes the default multi select (all tables)', async () => {
    const yes = await h.orm.query({ u: UserModel, p: PostModel }).exists().go();
    expect(yes).toBe(true);
  });

  it('first() returns the first row by order', async () => {
    const row = await joined()
      .order((t) => [t.p.id.asc])
      .first((t) => [t.u.name, t.p.title])
      .go();
    expect(row?.p.title).toBe('Hello Postgres');
  });

  it('first() returns undefined when nothing matches', async () => {
    const row = await joined()
      .where((t) => t.u.name.eq('Nobody'))
      .first((t) => [t.u.name])
      .go();
    expect(row).toBeUndefined();
  });
});

