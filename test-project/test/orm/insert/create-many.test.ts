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

describe('insertMany: batch insert', () => {
  it('inserts multiple rows in one query', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Alice', email: 'alice@batch.test', age: 30, active: true },
        { name: 'Bob', email: 'bob@batch.test', age: 25, active: false },
        { name: 'Carol', email: 'carol@batch.test', age: 35, active: true },
      ])
      .go();

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
    expect(rows[0].id).toBeDefined();
    // All IDs should be unique
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('returns all fields from created rows', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'Dave', email: 'dave@batch.test', age: 40, active: true }])
      .go();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Dave');
    expect(rows[0].email).toBe('dave@batch.test');
    expect(rows[0].age).toBe(40);
    expect(rows[0].active).toBe(true);
  });

  it('empty array throws instead of silently inserting nothing', () => {
    // Сознательное расхождение с легаси `createMany([])`, который возвращал
    // пустой результат: молчаливый no-op скрывал потерю данных, если список
    // собрался пустым из-за ошибки на стороне вызова.
    //
    // Падение sync-throw на точке сборки запроса (`_requireValues` в `go()`),
    // а не rejected-промис: ошибка конфигурации должна указывать на строку
    // вызова, как `set()` без `values()` и гарды DML.
    const finalizer = h.orm.insertMany(UserModel).values([]);
    expect(() => finalizer.go()).toThrow(/requires at least one row/);
  });

  it('created rows are queryable', async () => {
    await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'Eve', email: 'eve@batch.test', age: 28, active: true },
        { name: 'Frank', email: 'frank@batch.test', age: 22, active: false },
      ])
      .go();

    const eve = await h.orm
      .select(UserModel)
      .where((u) => u.email.eq('eve@batch.test'))
      .first()
      .go();

    expect(eve).toBeTruthy();
    expect(eve!.name).toBe('Eve');
  });

  it('transaction(true) is the default', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([
        { name: 'G1', email: 'g1@tx.test', age: 10, active: true },
        { name: 'G2', email: 'g2@tx.test', age: 20, active: false },
      ])
      .transaction(true)
      .go();

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('G1');
    expect(rows[1].name).toBe('G2');
  });

  it('transaction(false) sends one INSERT without BEGIN/COMMIT', async () => {
    const rows = await h.orm
      .insertMany(UserModel)
      .values([{ name: 'H1', email: 'h1@tx.test', age: 15, active: true }])
      .transaction(false)
      .go();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('H1');
  });
});
