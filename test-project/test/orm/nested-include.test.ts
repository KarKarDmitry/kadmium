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

describe('nested includes (depth > 1)', () => {
  it('to-one -> to-many: post.author.posts', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: { include: { posts: true } } })
      .first()
      .go();
    const author = post!.author!;
    expect(author).toBeTruthy();
    expect(author.name).toBe('Alice');
    expect(Array.isArray(author.posts)).toBe(true);
    expect(author.posts.length).toBe(2);
    for (const inner of author.posts) expect(inner.id).toBeTruthy();
  });

  it('to-many -> to-one: user.posts.author', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: { include: { author: true } } })
      .first()
      .go();
    const posts = alice!.posts!;
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBe(2);
    for (const inner of posts) {
      expect(inner.author).toBeTruthy();
      expect(inner.author!.name).toBe('Alice');
    }
  });

  it('3 levels: post.author.posts.comments', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({
        author: { include: { posts: { include: { comments: true } } } },
      })
      .first()
      .go();
    const author = post!.author!;
    const hello = author.posts.find((p) => p.title === 'Hello Postgres');
    const draft = author.posts.find((p) => p.title === 'Draft Post');
    expect(hello!.comments.length).toBe(2);
    expect(draft!.comments.length).toBe(0);
  });

  it('empty at depth: a post with no comments returns []', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Draft Post'))
      .include({
        author: { include: { posts: { include: { comments: true } } } },
      })
      .first()
      .go();
    const author = post!.author!;
    const draft = author.posts.find((p) => p.title === 'Draft Post');
    expect(draft!.comments).toEqual([]);
  });

  it('empty relation: Carol (no posts) returns []', async () => {
    const carol = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Carol'))
      .include({ posts: true })
      .first()
      .go();
    expect(carol!.posts).toEqual([]);
  });

  it('nested with inner .select() limits fields', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({
        author: { include: { posts: { select: (pp) => [pp.id] } } },
      })
      .first()
      .go();
    const author = post!.author!;
    for (const inner of author.posts) {
      expect(Object.keys(inner).sort()).toEqual(['id']);
    }
  });

  it('nested include on a multi-table query', async () => {
    const rows = await h.orm
      .query({ p: PostModel, a: UserModel })
      .join({ left: 'p', right: 'a', on: (t) => t.p.author.eq(t.a.id) })
      .where((t) => t.p.title.eq('Hello Postgres'))
      .include({ p: { author: { include: { posts: true } } } })
      .select((t) => [t.p.title])
      .go();
    expect(rows.length).toBe(1);
    const p = rows[0].p;
    const author = p.author!;
    expect(author).toBeTruthy();
    expect(Array.isArray(author.posts)).toBe(true);
  });
});
