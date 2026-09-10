import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { and, or } from '@karkardmitry/kadmium-core';
import { User as UserModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed } from '../fixtures';

let h: Harness;

const EXTRA_USERS: { name: string; age: number }[] = [
  { name: 'Dave', age: 22 },
  { name: 'Eve', age: 27 },
  { name: 'Ivy', age: 30 },
  { name: 'Jack', age: 30 },
  { name: 'Frank', age: 33 },
  { name: 'Grace', age: 45 },
  { name: 'Heidi', age: 48 },
];

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
  for (let i = 0; i < EXTRA_USERS.length; i++) {
    const u = EXTRA_USERS[i];
    await h.orm
      .single(UserModel)
      .create({
        name: u.name,
        email: `${u.name.toLowerCase()}@test.com`,
        age: u.age,
        active: true,
        registeredAt: new Date(`2024-04-0${i + 1}T00:00:00Z`),
      })
      .go();
  }
  // 10 пользователей: ages 22..48, с тремя на age=30 (Alice, Ivy, Jack)
});

afterAll(async () => {
  await h.adapter.end();
});

describe('cursor: keyset pagination', () => {
  it('forward single-key by id asc', async () => {
    const page1 = await h.orm
      .single(UserModel)
      .order((u) => [u.id.asc])
      .limit(2)
      .go();
    expect(page1.length).toBe(2);

    const page2 = await h.orm
      .single(UserModel)
      .order((u) => [u.id.asc])
      .cursor((u) => u.id.gt(page1[1].id))
      .limit(2)
      .go();
    expect(page2.length).toBe(2);
    expect(page2[0].id).toBeGreaterThan(page1[1].id);

    const page3 = await h.orm
      .single(UserModel)
      .order((u) => [u.id.asc])
      .cursor((u) => u.id.gt(page2[1].id))
      .limit(10)
      .go();
    expect(page3.length).toBe(6);

    const ids = [...page1, ...page2, ...page3].map((r) => r.id);
    expect(new Set(ids).size).toBe(10);
  });

  it('string key lexicographic cursor via gt', async () => {
    const page1 = await h.orm
      .single(UserModel)
      .order((u) => [u.name.asc])
      .limit(3)
      .go();
    expect(page1.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Carol']);

    const page2 = await h.orm
      .single(UserModel)
      .order((u) => [u.name.asc])
      .cursor((u) => u.name.gt('Carol'))
      .limit(10)
      .go();
    const page2Names = page2.map((r) => r.name);
    expect(page2Names).toContain('Dave');
    expect(page2Names).toContain('Frank');
    expect(page2Names).toContain('Grace');
    expect(page2Names).toContain('Heidi');
    expect(page2Names).toContain('Ivy');
    expect(page2Names).toContain('Jack');
    expect(page2Names.every((n) => n > 'Carol')).toBe(true);
    const known = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivy', 'Jack'];
    const covered = [...page1.map((r) => r.name), ...page2Names];
    expect(known.every((n) => covered.includes(n))).toBe(true);
    expect(page2Names.length).toBeGreaterThanOrEqual(7);
  });

  it('descending feed with lt cursor', async () => {
    const page1 = await h.orm
      .single(UserModel)
      .order((u) => [u.age.desc])
      .limit(3)
      .go();
    const boundary = page1[2].age;

    const page2 = await h.orm
      .single(UserModel)
      .order((u) => [u.age.desc])
      .cursor((u) => u.age.lt(boundary))
      .limit(10)
      .go();
    expect(page2.length).toBe(7);
    expect(page2.every((r) => r.age < boundary)).toBe(true);

    const ages = [...page1.map((r) => r.age), ...page2.map((r) => r.age)];
    for (let i = 1; i < ages.length; i++) {
      expect(ages[i - 1]).toBeGreaterThanOrEqual(ages[i]);
    }
  });

  it('multi-key composite (age asc, id asc) via or/and', async () => {
    const page1 = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .limit(4)
      .go();
    expect(page1.map((r) => r.name)).toEqual(['Dave', 'Bob', 'Eve', 'Alice']);
    const last = page1[3];

    const page2 = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .cursor((u) =>
        or(u.age.gt(last.age), and(u.age.eq(last.age), u.id.gt(last.id))),
      )
      .limit(4)
      .go();
    expect(page2.map((r) => r.age)).toEqual([30, 30, 33, 40]);
    expect(page2[0].id).toBeGreaterThan(last.id);

    const page3 = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .cursor((u) =>
        or(u.age.gt(page2[3].age), and(u.age.eq(page2[3].age), u.id.gt(page2[3].id))),
      )
      .limit(10)
      .go();
    expect(page3.map((r) => r.name)).toEqual(['Grace', 'Heidi']);
  });

  it('stable under inserts between pages (vs offset drift)', async () => {
    const page1 = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .limit(3)
      .go();
    expect(page1.map((r) => r.name)).toEqual(['Dave', 'Bob', 'Eve']);
    const boundary = page1[2].age;

    const before = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .cursor((u) => u.age.gt(boundary))
      .limit(3)
      .go();
    expect(before.map((r) => r.name)).toEqual(['Alice', 'Ivy', 'Jack']);

    await h.orm
      .single(UserModel)
      .create({
        name: 'Zoe',
        email: 'zoe@test.com',
        age: 26,
        active: true,
        registeredAt: new Date('2024-05-01T00:00:00Z'),
      })
      .go();

    const after = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .cursor((u) => u.age.gt(boundary))
      .limit(3)
      .go();
    expect(after.map((r) => r.name)).toEqual(['Alice', 'Ivy', 'Jack']);

    const offsetDrift = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .offset(3)
      .limit(3)
      .go();
    expect(offsetDrift.map((r) => r.name)).toEqual(['Eve', 'Alice', 'Ivy']);
  });

  it('inclusive boundary via gte', async () => {
    const rows = await h.orm
      .single(UserModel)
      .order((u) => [u.age.asc, u.id.asc])
      .cursor((u) => u.age.gte(30))
      .limit(3)
      .go();
    expect(rows[0].age).toBe(30);
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Ivy', 'Jack']);
  });

  it('throws without order()', () => {
    expect(() => h.orm.single(UserModel).cursor((u) => u.id.gt(1))).toThrow(
      /requires an order/,
    );
  });
});