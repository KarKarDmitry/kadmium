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

describe('returning: update / delete projection', () => {
  it('update().returning() returns only selected fields', async () => {
    const rows = await h.orm
      .single(UserModel)
      .update({ age: 31 })
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.id, u.age])
      .go();
    expect(rows).toHaveLength(1);
    expect('id' in rows[0]).toBe(true);
    expect(rows[0].age).toBe(31);
    expect('name' in rows[0]).toBe(false);
    expect('email' in rows[0]).toBe(false);
  });

  it('update().returning() with alias uses alias as key', async () => {
    const rows = await h.orm
      .single(UserModel)
      .update({ age: 32 })
      .where((u) => u.name.eq('Alice'))
      .returning((u) => [u.age.as('year')])
      .go();
    expect(rows).toEqual([{ year: 32 }]);
  });

  it('update().returning() without where affects all rows', async () => {
    const rows = await h.orm
      .single(PostModel)
      .update({ views: 1 })
      .returning((p) => [p.views])
      .go();
    expect(rows.length).toBe(3);
    for (const r of rows) expect(r.views).toBe(1);
    expect('title' in rows[0]).toBe(false);
  });

  it('update().returning() renders selectables into RETURNING clause', () => {
    const sql = h.orm
      .single(UserModel)
      .update({ active: true })
      .where((u) => u.name.eq('Bob'))
      .returning((u, { count }) => [count('*').as('total')])
      .sql();
    expect(sql).toContain('RETURNING COUNT(*) AS "total"');
  });

  it('update().go() without returning returns full row (regression)', async () => {
    const rows = await h.orm
      .single(UserModel)
      .update({ age: 30 })
      .where((u) => u.name.eq('Alice'))
      .go();
    expect(rows).toHaveLength(1);
    expect('name' in rows[0]).toBe(true);
    expect('email' in rows[0]).toBe(true);
  });

  it('delete().returning() returns deleted rows with projection', async () => {
    const deleted = await h.orm
      .single(PostModel)
      .delete()
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
      .single(PostModel)
      .create({ title: 'Temp Post', content: 'temp', author: 1 })
      .go();
    const deleted = await h.orm
      .single(PostModel)
      .delete()
      .where((p) => p.title.eq('Temp Post'))
      .go();
    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).toBe(created.id);
    expect('content' in deleted[0]).toBe(true);
    expect('title' in deleted[0]).toBe(true);
  });
});