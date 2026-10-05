import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Measurement } from '../../../src/models';
import { makeHarness, resetData, type Harness } from '../../helpers';

/**
 * B3/B4: PostgreSQL отдаёт `int8` и `numeric` строкой, а `~shape` обещает
 * `number`. Здесь проверяется, что приведение живёт в core, работает на всех
 * путях чтения и **не молчит** там, где `number` невозможен.
 *
 * Значения, которые нельзя выразить в DSL (id за 2^53, 17 значащих цифр в
 * numeric), заливаются прямым SQL — это единственный способ донести их до БД.
 */

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

beforeEach(async () => {
  // Количество строк здесь и есть проверяемое значение, поэтому данные
  // сбрасываются под каждый тест. Схему создаёт global-setup.
  await resetData(h);
});

afterAll(async () => {
  await h.adapter.end();
});

async function seed(label: string, amount: number, count: number) {
  await h.orm.insert(Measurement).values({ label, amount, count }).go();
}

/** Прямая вставка: DSL ограничивает `amount` типом number. */
async function rawInsert(sql: string) {
  await h.adapter.ddl.raw(sql);
}

describe('приведение numeric', () => {
  it('дробное значение приходит числом, а не строкой', async () => {
    await seed('price', 10.5, 2);
    const [row] = await h.orm.select(Measurement).go();
    expect(row.amount).toBe(10.5);
    expect(typeof row.amount).toBe('number');
  });

  it('хвостовые нули PG не считаются потерей точности', async () => {
    await rawInsert(
      `INSERT INTO measurement (label, amount, count) VALUES ('scale', 10.500, 1)`,
    );
    const [row] = await h.orm
      .select(Measurement)
      .where((t) => t.label.eq('scale'))
      .go();
    // 17 знаков после точки, но значащих цифр две.
    expect(row.amount).toBe(10.5);
  });

  it('потеря точности бросается, а не округляется молча', async () => {
    await rawInsert(
      `INSERT INTO measurement (label, amount, count) VALUES ('huge', 1234567890123456.7, 1)`,
    );
    const read = h.orm
      .select(Measurement)
      .where((t) => t.label.eq('huge'))
      .go();
    await expect(read).rejects.toThrow(/more than 15 significant digits/);
    await expect(read).rejects.toThrow(/Measurement\.amount/);
  });
});

describe('приведение int8', () => {
  it('bigint в пределах 2^53 — обычное число', async () => {
    await seed('ok', 1.5, 1);
    const [row] = await h.orm
      .select(Measurement)
      .where((t) => t.label.eq('ok'))
      .go();
    expect(typeof row.id).toBe('number');
  });

  it('id за 2^53 бросает ошибку вместо тихого округления', async () => {
    await rawInsert(
      `INSERT INTO measurement (id, label, amount, count) VALUES (9007199254740993, 'snowflake', 1, 1)`,
    );
    const read = h.orm
      .select(Measurement)
      .where((t) => t.label.eq('snowflake'))
      .go();
    await expect(read).rejects.toThrow(/outside the safe integer range/);
    await expect(read).rejects.toThrow(/Measurement\.id/);
  });

  it('FK на bigint-PK тоже сторожится', async () => {
    await rawInsert(
      `INSERT INTO measurement (id, label, amount, count) VALUES (9007199254740995, 'fk', 1, 1)`,
    );
    await expect(
      h.orm
        .select(Measurement)
        .where((t) => t.label.eq('fk'))
        .go(),
    ).rejects.toThrow(/outside the safe integer range/);
  });

  it('граница 2^53−1 ещё влезает', async () => {
    await rawInsert(
      `INSERT INTO measurement (id, label, amount, count) VALUES (9007199254740991, 'edge', 1, 1)`,
    );
    const [row] = await h.orm
      .select(Measurement)
      .where((t) => t.label.eq('edge'))
      .go();
    expect(row.id).toBe(9007199254740991);
  });
});

describe('приведение в агрегатах и окнах', () => {
  beforeEach(async () => {
    await seed('agg-1', 1.5, 2);
    await seed('agg-2', 2.25, 4);
  });

  it('count и sum приходят числами', async () => {
    const [row] = await h.orm
      .select(Measurement)
      .fields((m, { agg }) => [
        agg.count('*').as('cnt'),
        agg.sum(m.count).as('total'),
      ])
      .go();
    expect(row.cnt).toBe(2);
    expect(row.total).toBe(6);
  });

  it('avg над int4 приходит числом, хотя PG отдаёт numeric', async () => {
    const [row] = await h.orm
      .select(Measurement)
      .fields((m, { agg }) => [agg.avg(m.count).as('mean')])
      .go();
    expect(row.mean).toBe(3);
    expect(typeof row.mean).toBe('number');
  });

  it('row_number и rank приходят числами', async () => {
    const rows = await h.orm
      .select(Measurement)
      .order((m) => [m.count.asc])
      .fields((m, { wf }) => [
        wf.rowNumber().orderBy(m.count.asc).as('rn'),
        wf.rank().orderBy(m.count.asc).as('rk'),
      ])
      .go();
    expect(rows.map((r) => r.rn)).toEqual([1, 2]);
    expect(rows.map((r) => r.rk)).toEqual([1, 2]);
  });
});

describe('приведение на путях записи', () => {
  it('returning() отдаёт приведённую строку', async () => {
    await seed('upd', 1.5, 1);
    const rows = await h.orm
      .update(Measurement)
      .set({ amount: 3.25 })
      .where((t) => t.label.eq('upd'))
      .returning((t) => [t.label, t.amount])
      .go();
    expect(rows[0].amount).toBe(3.25);
  });

  it('go() без returning() тоже приводит', async () => {
    await seed('upd', 1.5, 1);
    const rows = await h.orm
      .update(Measurement)
      .set({ count: 7 })
      .where((t) => t.label.eq('upd'))
      .go();
    expect(typeof rows[0].amount).toBe('number');
  });
});

describe('приведение в compiled-запросе', () => {
  it('run(c).fill().go() приводит так же, как go()', async () => {
    await seed('compiled', 1.5, 1);
    const c = h.orm.select(Measurement).compile<Record<string, never>>();
    const rows = await h.orm.run(c).fill({}).go();
    expect(rows.length).toBe(1);
    expect(rows[0].amount).toBe(1.5);
  });
});
