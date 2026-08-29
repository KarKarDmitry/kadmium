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

describe('single: select / update / delete', () => {
  it('select() with no args returns all scalar fields', async () => {
    const rows = await h.orm.single(UserModel).select().go();
    expect(rows.length).toBe(3);
    const alice = rows.find((r) => r.name === 'Alice')!;
    expect(alice.id).toBeTruthy();
    expect(alice.email).toBe('alice@test.com');
    expect(alice.age).toBe(30);
    expect(alice.active).toBe(true);
  });

  it('select() with field projection + alias', async () => {
    const rows = await h.orm
      .single(UserModel)
      .select((u) => [u.name.as('userName'), u.email])
      .go();
    expect(rows[0].userName).toBe('Alice');
    expect(rows[0].email).toBe('alice@test.com');
    expect('age' in rows[0]).toBe(false);
  });

  it('update() sets fields and returns updated row', async () => {
    const updated = await h.orm
      .single(PostModel)
      .update({ title: 'Renamed' })
      .where((p) => p.title.eq('Hello Postgres'))
      .go();
    expect(updated.length).toBe(1);
    expect(updated[0].title).toBe('Renamed');
  });

  it('update() without where affects all rows', async () => {
    const rows = await h.orm.single(PostModel).update({ views: 0 }).go();
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.views).toBe(0);
  });

  it('delete() removes matching rows', async () => {
    const deleted = await h.orm
      .single(PostModel)
      .delete()
      .where((p) => p.title.eq('Draft Post'))
      .go();
    expect(deleted.length).toBe(1);

    const remaining = await h.orm.single(PostModel).select((p) => [p.title]).go();
    expect(remaining.map((r) => r.title)).not.toContain('Draft Post');
  });

  it('count() and aggregates work', async () => {
    const n = await h.orm.single(PostModel).count().go();
    expect(n).toBe(2); // после удаления Draft Post в прошлом тесте
  });
});
