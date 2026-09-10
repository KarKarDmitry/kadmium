import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Comment as CommentModel } from '../../src/models';
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

describe('alias(): property name vs DB column name', () => {
  it('DDL names the column after the alias (is_flagged), not the property', async () => {
    const cols = await h.adapter.ddl.inspectColumns('comment');
    expect(cols.find((c) => c.name === 'is_flagged')).toBeDefined();
    expect(cols.find((c) => c.name === 'flagged')).toBeUndefined();
  });

  it('create() writes to the aliased column and returns the property key', async () => {
    const comment = await h.orm.single(CommentModel).create({
      text: 'flag me',
      flagged: true,
      post: null,
      user: null,
    }).go();
    expect(comment.flagged).toBe(true);
    expect('flagged' in comment).toBe(true);
    expect('is_flagged' in comment).toBe(false);
  });

  it('select() returns the property key with the aliased column value', async () => {
    await h.orm.single(CommentModel).create({
      text: 'flag read',
      flagged: true,
      post: null,
      user: null,
    }).go();
    const rows = await h.orm
      .single(CommentModel)
      .where((c) => c.text.eq('flag read'))
      .select((c) => [c.text, c.flagged])
      .go();
    expect(rows.length).toBe(1);
    expect('flagged' in rows[0]).toBe(true);
    expect('is_flagged' in rows[0]).toBe(false);
    expect(rows[0].flagged).toBe(true);
  });

  it('filter uses the aliased column name in WHERE', async () => {
    await h.orm.single(CommentModel).create({
      text: 'flag filter',
      flagged: true,
      post: null,
      user: null,
    }).go();
    await h.orm.single(CommentModel).create({
      text: 'no flag',
      flagged: false,
      post: null,
      user: null,
    }).go();
    const rows = await h.orm
      .single(CommentModel)
      .where((c) => c.flagged.eq(true))
      .select((c) => [c.text])
      .go();
    const texts = rows.map((r) => r.text);
    expect(texts).toContain('flag filter');
    expect(texts).not.toContain('no flag');
  });

  it('update() sets the aliased column and returns the property key', async () => {
    const created = await h.orm.single(CommentModel).create({
      text: 'flag update',
      flagged: false,
      post: null,
      user: null,
    }).go();
    const updated = await h.orm
      .single(CommentModel)
      .update({ flagged: true })
      .where((c) => c.id.eq(created.id))
      .go();
    expect(updated.length).toBe(1);
    expect(updated[0].flagged).toBe(true);
  });

  it('order by aliased column works', async () => {
    const rows = await h.orm
      .single(CommentModel)
      .select((c) => [c.text])
      .order((c) => [c.flagged.asc])
      .go();
    expect(Array.isArray(rows)).toBe(true);
  });
});
