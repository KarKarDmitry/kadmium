import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Post as PostModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('returning: delete projection', () => {
  it('delete().returning() returns deleted rows with projection', async () => {
    const deleted = await h.orm
      .delete(PostModel)
      .where((p) => p.title.eq('Draft Post'))
      .returning((p) => [p.id, p.title])
      .go();
    expect(deleted).toHaveLength(1);
    expect('id' in deleted[0]).toBe(true);
    expect(deleted[0].title).toBe('Draft Post');
    expect('content' in deleted[0]).toBe(false);
  });

  it('delete().go() without returning returns full rows (regression)', async () => {
    const created = await h.orm
      .insert(PostModel)
      .values({ title: 'Temp Post', content: 'temp', author: 1 })
      .go();
    const deleted = await h.orm
      .delete(PostModel)
      .where((p) => p.title.eq('Temp Post'))
      .go();
    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe(created.id);
    expect('content' in deleted[0]).toBe(true);
    expect('title' in deleted[0]).toBe(true);
  });
});
