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
      .include((p) => [p.author])
      .first()
      .go();
    console.log('[include to-one] row =', JSON.stringify(post, null, 2));
    // Контракт: author — вложенный объект User, а не JSON-строка
    expect(post).toBeTruthy();
    expect(typeof post!.author).toBe('object');
    expect(post!.author).not.toBeNull();
    expect((post!.author as any).name).toBe('Alice');
  });

  it('single-table to-many: User -> posts is an array', async () => {
    const alice = await h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .include((u) => [u.posts])
      .first()
      .go();
    console.log('[include to-many] row =', JSON.stringify(alice, null, 2));
    expect(alice).toBeTruthy();
    expect(Array.isArray((alice! as any).posts)).toBe(true);
    expect((alice! as any).posts.length).toBe(2);
  });

  it('nested include: Post -> author -> posts', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include((p) => [p.author.include((a) => [a.posts])])
      .first()
      .go();
    console.log(
      '[include nested] author.posts =',
      JSON.stringify((post as any)?.author?.posts),
    );
    expect(post).toBeTruthy();
    const author = (post as any).author;
    expect(typeof author).toBe('object');
    expect(author).not.toBeNull();
    expect(author.name).toBe('Alice');
    // Внутренний to-many include должен вернуться массивом
    expect(Array.isArray(author.posts)).toBe(true);
    expect(author.posts.length).toBe(2);
    expect(author.posts[0].title).toBeTruthy();
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
      .include((t) => [t.a.posts])
      .select((t) => [t.p.title])
      .go();
    console.log('[include multi] rows =', JSON.stringify(rows, null, 2));
    expect(rows.length).toBe(1);
    // Контракт: включает вложены под alias родителя
    expect(rows[0].p.title).toBe('Hello Postgres');
  });
});
