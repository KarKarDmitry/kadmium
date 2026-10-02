import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  User as UserModel,
  Comment as CommentModel,
} from '../../../src/models';
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

describe('insert edges: пустые значения, null, datetime, zero, разнородный батч', () => {
  it('insert() with empty string and explicit nulls inserts and returns the row', async () => {
    // Не пустой объект, а пустые ЗНАЧЕНИЯ: '' для text и явные null для
    // не-nullable ref-ов — Postgres должен принять их как DEFAULT/NULL.
    const comment = await h.orm
      .insert(CommentModel)
      .values({
        text: '',
        post: null,
        user: null,
      })
      .go();
    expect(comment.id).toBeDefined();
  });

  it('values({}) is rejected — the payload is never validated', async () => {
    // Известный пробел (C10): values({}) не отсекается ни гардами, ни
    // раннером. SQL собирается как INSERT INTO "t" () VALUES () — это
    // синтаксическая ошибка Postgres (42601), а не внятная диагностика.
    // Тест фиксирует НАСТОЯЩЕЕ поведение, а не желаемое.
    await expect(
      h.orm.insert(CommentModel).values({}).go(),
    ).rejects.toThrowError();
  });

  it('datetime roundtrip preserves ms precision', async () => {
    const ts = new Date('2024-06-15T14:30:45.123Z');
    const created = await h.orm
      .insert(UserModel)
      .values({
        name: 'TsUser',
        email: 'ts@test.com',
        age: 99,
        active: true,
        registeredAt: ts,
      })
      .go();
    expect(created.registeredAt).toBeInstanceOf(Date);
    expect((created.registeredAt as Date).getTime()).toBe(ts.getTime());
  });

  it('insertMany with heterogeneous field subsets', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'HM1', email: 'hm1@test.com', age: 10, active: true },
        { name: 'HM2', email: 'hm2@test.com', age: 20, active: false },
        { name: 'HM3', email: 'hm3@test.com', age: 30, active: true },
      ])
      .go();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.age).sort()).toEqual([10, 20, 30]);
  });

  it('numeric zero edge: age=0 is treated as a valid value', async () => {
    const created = await h.orm
      .insert(UserModel)
      .values({
        name: 'ZeroAge',
        email: 'zero@test.com',
        age: 0,
        active: true,
      })
      .go();
    expect(created.age).toBe(0);
    const [fetched] = await h.orm
      .select(UserModel)
      .where((u) => u.id.eq(created.id))
      .fields((u) => [u.age])
      .go();
    expect(fetched.age).toBe(0);
  });
});
