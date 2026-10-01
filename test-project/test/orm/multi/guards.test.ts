import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  User as UserModel,
  Post as PostModel,
} from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed } from '../../fixtures';

/**
 * Runtime-гарды на `orm.query()`: алиас таблицы и дубликат join().
 *
 * Оба ловят ошибку на строке сборки запроса, а не в терминале — чтобы
 * опечатка в алиасе прилетала как «Unknown table alias», а не как
 * PostgreSQL 42P01 из глубины стека.
 *
 * Гарды на DML — в `legacy/guards-single.test.ts` (нужен билдер, где
 * limit/order/cursor вызываются до DML); на multi они неприменимы.
 */

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('guards: orm.query() — алиас таблицы и дубликат join', () => {
  /**
   * Селект по алиасу, которого нет в запросе. Типы это не ловят: multi-прокси
   * отдаёт поле с column=undefined, и запрос падал бы в PostgreSQL (42P01)
   * ниже по стеку и в другом файле. `as never` — чтобы проскочить мимо
   * AnySelectable в сигнатуре перегрузки select().
   */
  const fieldOn = (t: unknown, alias: string): never =>
    (t as Record<string, { id: never }>)[alias].id;

  it('select() с чужим алиасом бросает до обращения к БД', () => {
    expect(() =>
      h.orm.query({ u: UserModel }).fields((t) => [fieldOn(t, 'p')]),
    ).toThrow(/Unknown table alias "p" in select\(\)/);
  });

  it('сообщение перечисляет реальные алиасы запроса', () => {
    expect(() =>
      h.orm.query({ u: UserModel }).fields((t) => [fieldOn(t, 'zz')]),
    ).toThrow(/Query tables are: u\./);
  });

  it('сообщение подсказывает, где задаются алиасы', () => {
    expect(() =>
      h.orm.query({ u: UserModel }).fields((t) => [fieldOn(t, 'p')]),
    ).toThrow(/Check the aliases passed to orm\.query\(\{\.\.\.\}\)/);
  });

  it('first() проверяет алиасы так же, как select()', () => {
    expect(() =>
      h.orm.query({ u: UserModel }).first((t) => [fieldOn(t, 'q')]),
    ).toThrow(/Unknown table alias "q" in select\(\)/);
  });

  it('несколько неизвестных алиасов — одно сообщение, без дублей', () => {
    expect(() =>
      h.orm
        .query({ u: UserModel })
        .fields((t) => [fieldOn(t, 'x'), fieldOn(t, 'x'), fieldOn(t, 'y')]),
    ).toThrow(/Unknown table aliases "x", "y" in select\(\)/);
  });

  it('валидные алиасы нескольких таблиц проходят', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .fields((t) => [t.u.name, t.p.title])
      .go();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('агрегаты и оконные функции без tableAlias проходят', async () => {
    const rows = await h.orm
      .query({ u: UserModel, p: PostModel })
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .fields((t, { agg }) => [agg.count('*').as('total')])
      .go();
    expect(rows.length).toBeGreaterThan(0);
  });

  it('гард на алиас не ломает запрос к компиляции: ошибка на этапе сборки', () => {
    expect(() =>
      h.orm
        .query({ u: UserModel })
        .fields((t) => [fieldOn(t, 'p')])
        .compile(),
    ).toThrow(/Unknown table alias/);
  });

  it('дубликат join() падает на строке сборки, данные не пострадали', async () => {
    const q = () => h.orm.query({ u: UserModel, p: PostModel });
    const build = () =>
      q()
        .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
        // Второй join той же пары: раньше молча игнорировался
        .join({ left: 'u', right: 'p', on: (t) => t.p.published.eq(true) });
    expect(() => build()).toThrow(
      /join\(\) on u ↔ p \(inner\) is already declared/,
    );
    // Тот же запрос без дубля по-прежнему работает — гард точечный
    const rows = await q()
      .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author) })
      .fields((t) => [t.u.name, t.p.title])
      .go();
    expect(rows.length).toBeGreaterThan(0);
  });
});
