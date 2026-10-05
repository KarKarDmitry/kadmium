import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql, slot, SelectableField } from '@karkardmitry/kadmium-core';
import { User as UserModel } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';
import { resetAndSeed, type SeedData } from '../../fixtures';

let h: Harness;
let seed: SeedData;

beforeAll(async () => {
  h = await makeHarness();
  seed = await resetAndSeed(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('orm.raw — raw-фрагменты против PG', () => {
  it('фрагмент целиком: те же строки, что билдер', async () => {
    const frag = await h.orm
      .raw<{ name: string }>(
        sql`SELECT name FROM "user" WHERE active ORDER BY name`,
      )
      .go();
    const built = await h.orm
      .select(UserModel)
      .where((u) => u.active.eq(true))
      .order((u) => [u.name.asc])
      .fields((u) => [u.name])
      .go();
    expect(frag).toEqual(built);
    expect(frag.map((r) => r.name)).toEqual(['Alice', 'Carol']);
  });

  it('слоты через .fill(): значения как параметры', async () => {
    const rows = await h.orm
      .raw<{ name: string }>(
        sql`SELECT name FROM "user" WHERE age > ${slot('minAge')} AND age < ${slot('maxAge')}`.fill(
          { minAge: 26, maxAge: 41 },
        ),
      )
      .go();
    expect(rows.map((r) => r.name).sort()).toEqual(['Alice', 'Carol']);
  });

  it('три формы одного запроса дают одинаковый результат', async () => {
    const viaText = await h.orm
      .raw<{ name: string }>('SELECT name FROM "user" WHERE email = $1', [
        'alice@test.com',
      ])
      .go();
    const viaFragment = await h.orm
      .raw<{ name: string }>(
        sql`SELECT name FROM "user" WHERE email = ${'alice@test.com'}`,
      )
      .go();
    const viaFill = await h.orm
      .raw<{ name: string }>(
        sql`SELECT name FROM "user" WHERE email = ${slot('email')}`.fill({
          email: 'alice@test.com',
        }),
      )
      .go();
    const expected = [{ name: 'Alice' }];
    expect(viaText).toEqual(expected);
    expect(viaFragment).toEqual(expected);
    expect(viaFill).toEqual(expected);
  });

  it('SelectableField рендерится как идентификатор в raw-фрагменте', async () => {
    const name = new SelectableField('u', 'name');
    const rows = await h.orm
      .raw<{ uname: string }>(
        sql`SELECT ${name} AS uname FROM "user" AS u ORDER BY ${name}`,
      )
      .go();
    expect(rows.map((r) => r.uname)).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('без .tsType() int8 приходит строкой — тип объявляет пользователь', async () => {
    // Нетегированный фрагмент отдаёт ровно то, что прислала БД: `user.id` —
    // bigint, то есть int8, то есть строка. Объявлять `id: number` здесь
    // было бы ложью: ORM не знает, что это не текст, и молчал бы.
    const rows = await h.orm
      .raw<{ id: string; name: string }>(
        sql`SELECT id, name FROM "user" WHERE email = ${'alice@test.com'}`,
      )
      .go();
    expect(rows).toEqual([{ id: String(seed.alice.id), name: 'Alice' }]);
  });

  it('.tsType() превращает int8 в проекции в number', async () => {
    // Проекция знает колонку по имени, поэтому тег ставится на неё. Без него
    // `count(*)` в сыром фрагменте вернул бы строку '3' — ровно то, что
    // прислала БД, но против объявленного `number`.
    const [row] = await h.orm
      .select(UserModel)
      .fields(() => [sql`count(*)`.as('cnt').tsType()])
      .go();
    expect(row.cnt).toBe(3);
  });

  it('без .tsType() сырой count остаётся строкой', async () => {
    const [row] = await h.orm
      .select(UserModel)
      .fields(() => [sql`count(*)`.as('cnt')])
      .go();
    expect(row.cnt).toBe('3');
  });
});
