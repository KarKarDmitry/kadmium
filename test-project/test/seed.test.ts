import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel, Post as PostModel } from '../src/models';
import { makeHarness, type Harness } from './helpers';
import { resetAndSeed } from './fixtures';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('seed: create via ORM layer', () => {
  it('creates users through orm.single().create()', async () => {
    const row = await h.orm.single(UserModel).create({
      name: 'Dave',
      email: 'dave@test.com',
      age: 22,
      active: true,
      registeredAt: new Date(),
    });
    expect(row).toBeTruthy();
    expect(row.name).toBe('Dave');
    expect(row.email).toBe('dave@test.com');
    expect(row.id).toBeTruthy();
    // bigint (int8) нормализуется в number на уровне адаптера (D8)
    expect(typeof row.id).toBe('number');
    expect(Number.isInteger(row.id)).toBe(true);
  });

  it('count() matches seeded rows', async () => {
    const users = await h.orm.single(UserModel).count().go();
    // 3 из фикстур + 1 (Dave) из предыдущего теста
    expect(users).toBe(4);
  });

  it('read-back a seeded post with its author FK', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .first()
      .go();
    expect(post).toBeTruthy();
    expect(post!.author).toBeTruthy();
  });

  it('toSql() produces parameterized SQL (no inline values)', async () => {
    const sql = h.orm
      .single(UserModel)
      .where((u) => u.name.eq('Alice'))
      .toSql();
    expect(sql).toMatch(/VALUES:\s*\[/);
    // имя не должно быть вшито в текст запроса
    expect(sql).not.toContain("'Alice'");
  });
});

describe('D8: bigint PK normalizes to number', () => {
  it('findById accepts a number and returns a numeric id', async () => {
    const found = await h.orm.single(UserModel).findById(1).go();
    expect(found).toBeTruthy();
    expect(typeof found!.id).toBe('number');
    expect(Number.isInteger(found!.id)).toBe(true);
  });

  it('bigint FK column returns a number too', async () => {
    const post = await h.orm
      .single(PostModel)
      .where((p) => p.title.eq('Hello Postgres'))
      .first()
      .go();
    expect(typeof post!.author).toBe('number');
  });
});
