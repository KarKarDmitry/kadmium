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

describe('include: heavy combinations', () => {
  it('to-many: inner where + order + limit combine', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({
        posts: {
          where: (p) => p.published.eq(true),
          order: (p) => [p.views.desc],
          limit: 1,
        },
      })
      .first()
      .go();
    expect(alice!.posts).toHaveLength(1);
    expect(alice!.posts[0].title).toBe('Hello Postgres');
  });

  it('to-many: inner order only (all children must be ordered)', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: { order: (p) => [p.views.desc] } })
      .first()
      .go();
    expect(alice!.posts).toHaveLength(2);
    expect(alice!.posts.map((p) => p.views)).toEqual([10, 0]);
  });

  it('to-many: inner limit only returns the first children', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include({ posts: { limit: 1 } })
      .first()
      .go();
    expect(alice!.posts).toHaveLength(1);
  });

  it('to-one: inner where that matches nothing yields null', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: { where: (a) => a.name.eq('Nobody') } })
      .first()
      .go();
    expect(post!.author).toBeNull();
  });

  it('to-one: include alias config adds a property alias', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: { alias: 'authoredBy' } })
      .first()
      .go();
    expect(post!.authoredBy).toBeTruthy();
    expect(post!.authoredBy.name).toBe('Alice');
  });

  it('multiple includes on the same parent populate independently', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: true, comments: true })
      .first()
      .go();
    expect(post!.author).toBeTruthy();
    expect(post!.author!.name).toBe('Alice');
    expect(Array.isArray(post!.comments)).toBe(true);
    expect(post!.comments).toHaveLength(2);
  });

  it('parent pagination keeps full children on every row', async () => {
    const posts = await h.orm
      .single(PostModel)
      .order((p) => [p.title.desc])
      .limit(2)
      .include({ comments: true })
      .go();
    expect(posts).toHaveLength(2);
    const withComments = posts.filter((p) => p.comments.length > 0);
    // title DESC: Hello Postgres(2 comments), Draft Post(0)
    expect(withComments).toHaveLength(1);
    expect(withComments[0].title).toBe('Hello Postgres');
  });

  it('nested to-many limit applies at depth', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({
        author: { include: { posts: { limit: 1 } } },
      })
      .first()
      .go();
    expect(post!.author!.posts).toHaveLength(1);
  });

  it('relation via a second ref path: user.comments', async () => {
    const bob = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Bob'))
      .include({ comments: true })
      .first()
      .go();
    expect(bob!.comments).toHaveLength(1);
    expect(bob!.comments[0].text).toBe('lgtm');
  });
});
