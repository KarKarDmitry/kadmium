import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { sql, slot, SelectableField } from '@karkardmitry/kadmium-core';
import { User as UserModel } from '../../src/models';
import { makeHarness, type Harness } from '../helpers';
import { resetAndSeed, type SeedData } from '../fixtures';

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
      .single(UserModel)
      .where((u) => u.active.eq(true))
      .order((u) => [u.name.asc])
      .select((u) => [u.name])
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

  it('id из seed совпадает с raw-витриной (uuid → строка)', async () => {
    const rows = await h.orm
      .raw<{ id: string; name: string }>(
        sql`SELECT id, name FROM "user" WHERE email = ${'alice@test.com'}`,
      )
      .go();
    expect(rows).toEqual([{ id: seed.alice.id, name: 'Alice' }]);
  });
});
