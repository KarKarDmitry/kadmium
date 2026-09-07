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
      .select((t, { count }) => [t.u.name, count(t.p.id).as('postCount')])
      .go();
    console.log('[multi groupBy+count] rows =', JSON.stringify(rows));
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
