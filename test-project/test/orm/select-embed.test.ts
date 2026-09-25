import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql, SelectableField } from '@karkardmitry/kadmium-core';
import { User as UserModel } from '../../src/models';
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

describe('select — sql-фрагмент в SELECT против PG', () => {
  it('колбек: прокси-поле инлайнится, результат резолвится по алиасу', async () => {
    const rows = await h.orm
      .single(UserModel)
      .select((u) => [
        u.name,
        sql<number>`EXTRACT(YEAR FROM ${u.registeredAt})::int`.as('year'),
      ])
      .order((u) => [u.name.asc])
      .go();

    const names: string[] = rows.map((r) => r.name!);
    const years: number[] = rows.map((r) => r.year);
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);
    expect(years).toEqual([2024, 2024, 2024]);
  });

  it('compile(): текст содержит фрагмент и алиас', async () => {
    const c = h.orm
      .single(UserModel)
      .select((u) => [
        u.name,
        sql<number>`EXTRACT(YEAR FROM ${u.registeredAt})::int`.as('year'),
      ])
      .compile();
    expect(c.text).toContain(
      'SELECT "User"."name" AS "name", EXTRACT(YEAR FROM "User"."registeredAt")::int AS "year"',
    );
    expect(c.text).toContain('FROM "user" AS "User"');
  });

  it('готовый список без колбека: sql-фрагмент + поле', async () => {
    const registeredAt = new SelectableField('User', 'registeredAt');
    const rows = await h.orm
      .single(UserModel)
      .select([
        sql<number>`EXTRACT(YEAR FROM ${registeredAt})::int`.as('year'),
      ])
      .order((u) => [u.name.asc])
      .go();

    const years: number[] = rows.map((r) => r.year);
    expect(years).toEqual([2024, 2024, 2024]);
  });

  it('first(): один элемент, limit вниз, разворачивание объекта', async () => {
    const row = await h.orm
      .single(UserModel)
      .order((u) => [u.name.asc])
      .first(
        sql<number>`EXTRACT(YEAR FROM "User"."registeredAt")::int`.as('year'),
      )
      .go();

    expect(row).toEqual({ year: 2024 });
  });

  it('multi: фрагмент по полю другой таблицы', async () => {
    const rows = await h.orm
      .query({ u: UserModel })
      .where((t) => t.u.active.eq(true))
      .select((t) => [
        t.u.name,
        sql<string>`UPPER(${t.u.name})`.as('upper_name'),
      ])
      .go();

    // single-alias multi: selectable-поля вложены под алиас
    const names = rows.map((r) => r.u.name).sort();
    expect(names).toEqual(['Alice', 'Carol']);
    const upper: string[] = rows.map((r) => r.upper_name).sort();
    expect(upper).toEqual(['ALICE', 'CAROL']);
  });
});
