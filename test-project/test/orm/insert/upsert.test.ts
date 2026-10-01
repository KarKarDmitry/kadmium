import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { User as UserModel } from '../../../src/models';
import { makeHarness, resetData, type Harness } from '../../helpers';

let h: Harness;

beforeAll(async () => {
  // Схему создаёт globalSetup один раз на прогон. Данные тоже чистим: файлы
  // идут последовательно и делят одну БД, так что без этого результат зависел
  // бы от того, что успел сделать предыдущий файл.
  h = await makeHarness();
  await resetData(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('insert().onConflict() — upsert', () => {
  it('inserts new row when no conflict', async () => {
    const user = await h.orm
      .insert(UserModel)
      .values({ name: 'Alice', email: 'alice@upsert.test', age: 30, active: true })
      .onConflict((t) => [t.email])
      .go();

    expect(user.id).toBeDefined();
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@upsert.test');
  });

  it('updates existing row on conflict', async () => {
    // Insert first
    await h.orm
      .insert(UserModel)
      .values({ name: 'Bob', email: 'bob@upsert.test', age: 25, active: true })
      .onConflict((t) => [t.email])
      .go();

    // Upsert with same email, different name
    const updated = await h.orm
      .insert(UserModel)
      .values({ name: 'Robert', email: 'bob@upsert.test', age: 26, active: false })
      .onConflict((t) => [t.email])
      .go();

    expect(updated.name).toBe('Robert');
    expect(updated.age).toBe(26);
    expect(updated.active).toBe(false);

    // Verify only one row exists
    const count = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('bob@upsert.test'))
      .count()
      .go();
    expect(count).toBe(1);
  });

  it('doNothing skips insert on conflict', async () => {
    // Insert first
    await h.orm
      .insert(UserModel)
      .values({ name: 'Carol', email: 'carol@upsert.test', age: 40, active: true })
      .onConflict((t) => [t.email])
      .go();

    // Upsert with same email — should do nothing
    const result = await h.orm
      .insert(UserModel)
      .values({ name: 'CarolNew', email: 'carol@upsert.test', age: 41, active: false })
      .onConflict((t) => [t.email])
      .doNothing()
      .go();

    // DO NOTHING with RETURNING * returns empty object
    expect(result).toEqual({});

    // Verify original data is unchanged
    const carol = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('carol@upsert.test'))
      .first()
      .go();
    expect(carol!.name).toBe('Carol');
    expect(carol!.age).toBe(40);
  });

  it('sql() returns correct SQL', async () => {
    const sql = h.orm
      .insert(UserModel)
      .values({ name: 'Test', email: 'test@sql.test', age: 1, active: true })
      .onConflict((t) => [t.email])
      .sql();

    expect(sql).toContain('INSERT INTO "user"');
    expect(sql).toContain('ON CONFLICT ("email") DO UPDATE SET');
    expect(sql).toContain('EXCLUDED."name"');
    expect(sql).toContain('RETURNING *');
  });

  it('sql() for doNothing', async () => {
    const sql = h.orm
      .insert(UserModel)
      .values({ name: 'Test', email: 'test@sql.test', age: 1, active: true })
      .onConflict((t) => [t.email])
      .doNothing()
      .sql();

    expect(sql).toContain('ON CONFLICT ("email") DO NOTHING');
  });

  it('insert().go() still works as plain insert', async () => {
    const user = await h.orm
      .insert(UserModel)
      .values({ name: 'Dave', email: 'dave@upsert.test', age: 35, active: true })
      .go();

    expect(user.id).toBeDefined();
    expect(user.name).toBe('Dave');
  });
});

describe('insertMany().onConflict() — batch upsert', () => {
  it('inserts new rows', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Eve', email: 'eve@batch.test', age: 28, active: true },
        { name: 'Frank', email: 'frank@batch.test', age: 22, active: false },
      ])
      .onConflict((t) => [t.email])
      .go();

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('Eve');
    expect(rows[1].name).toBe('Frank');
  });

  it('updates existing rows on conflict', async () => {
    // Insert first
    await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Grace', email: 'grace@batch.test', age: 30, active: true },
      ])
      .onConflict((t) => [t.email])
      .go();

    // Upsert with same email
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'GraceUpdated', email: 'grace@batch.test', age: 31, active: false },
      ])
      .onConflict((t) => [t.email])
      .go();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('GraceUpdated');
    expect(rows[0].age).toBe(31);
  });

  it('mixed insert + update in a single batch statement', async () => {
    // Insert first (will be updated by the batch)
    await h.orm
      .insert(UserModel)
      .values({ name: 'Helen', email: 'helen@mix.test', age: 44, active: true })
      .go();

    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Iris', email: 'iris@mix.test', age: 20, active: true },
        { name: 'HelenUpdated', email: 'helen@mix.test', age: 45, active: false },
      ])
      .onConflict((t) => [t.email])
      .go();

    expect(rows).toHaveLength(2);
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(byEmail['iris@mix.test'].name).toBe('Iris');
    expect(byEmail['helen@mix.test'].name).toBe('HelenUpdated');
    expect(byEmail['helen@mix.test'].age).toBe(45);

    // No duplicates for the updated email
    const count = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('helen@mix.test'))
      .count()
      .go();
    expect(count).toBe(1);
  });

  it('doNothing batch returns only actually inserted rows', async () => {
    await h.orm
      .insert(UserModel)
      .values({ name: 'John', email: 'john@nothing.test', age: 33, active: true })
      .go();

    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'JohnUpdated', email: 'john@nothing.test', age: 99, active: false },
        { name: 'Kate', email: 'kate@nothing.test', age: 27, active: true },
      ])
      .onConflict((t) => [t.email])
      .doNothing()
      .go();

    // DO NOTHING + RETURNING: only the inserted row comes back
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Kate');

    const john = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('john@nothing.test'))
      .first()
      .go();
    expect(john!.name).toBe('John');
    expect(john!.age).toBe(33);
  });
});
