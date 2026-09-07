import { beforeAll, afterAll, describe, it, expect } from 'vitest';
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

describe('include: to-one / to-many / nested', () => {
  it('single-table to-one: Post -> author is a nested object', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: true })
      .first()
      .go();
    console.log('[include to-one] row =', JSON.stringify(post, null, 2));
    expect(post).toBeTruthy();
    expect(typeof post!.author).toBe('object');
    expect(post!.author).not.toBeNull();
    expect(post!.author!.name).toBe('Alice');
  });

  it('single-table to-many: User -> posts is an array', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: true })
      .first()
      .go();
    console.log('[include to-many] row =', JSON.stringify(alice, null, 2));
    expect(alice).toBeTruthy();
    expect(Array.isArray(alice!.posts)).toBe(true);
    expect(alice!.posts.length).toBe(2);
  });

  it('multi-table include: reshape nests under aliases', async () => {
    const rows = await h.orm
      .query({ p: PostModel, a: UserModel })
      .join({
        left: 'p',
        right: 'a',
        on: (t) => t.p.author.eq(t.a.id),
      })
      .where((t) => t.p.title.eq('Hello Postgres'))
      .include({ a: { posts: true } })
      .select((t) => [t.p.title])
      .go();
    console.log('[include multi] rows =', JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(1);
    expect(rows[0].p.title).toBe('Hello Postgres');
  });
});
