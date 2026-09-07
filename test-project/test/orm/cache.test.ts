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

describe('IR cache: hot path reuses the registry, no recompilation', () => {
  it('compiling is done once at registration, not per query', async () => {
    expect(h.orm.compileCount).toBe(0);

    await h.orm.single(UserModel).where((u) => u.name.eq('Alice')).go();
    await h.orm.single(UserModel).where((u) => u.name.eq('Bob')).go();
    await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .include({ author: true })
      .go();
    await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .select((t) => [t.u.name])
      .go();

    expect(h.orm.compileCount).toBe(0);
  });

  it('returns correct data after cached IR lookup', async () => {
    const rows = await h.orm.single(UserModel).select((u) => [u.name]).go();
    expect(rows.length).toBeGreaterThan(0);
  });
});
