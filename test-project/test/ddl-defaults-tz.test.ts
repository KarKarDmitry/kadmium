import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { renderDefault } from '@karkardmitry/kadmium-sql-pg';
import { makeHarness, type Harness } from './helpers';
import type { IrField } from '@karkardmitry/kadmium-sql-pg/dist/diff';
import type { DbColumn } from '@karkardmitry/kadmium-sql-types';

/**
 * Регрессия B5: значение, взятое из `DEFAULT`, должно совпадать с тем же
 * значением, записанным явным параметром.
 *
 * Проверять это обязательно под не-UTC `TZ`, иначе тест зелёный на баге.
 * Исходный `renderDefault()` писал `Date` как `toISOString()`, то есть как
 * инстант в UTC. Для `timestamp without time zone` PostgreSQL офсет отбрасывает
 * и берёт календарные поля UTC — под UTC это неотличимо от локального времени,
 * а под `Asia/Tokyo` даёт расхождение на 9 часов: `DEFAULT` давал 00:30, а
 * явный INSERT — 09:30.
 *
 * Драйвер здесь не при чём: он одинаково сериализует `Date` в обоих путях.
 * Расходились именно литералы, которые ORM генерировал для `DEFAULT`.
 *
 * Таблица создаётся через `ddl.createTable` — тот же путь, что и `applyDiff`,
 * поэтому под проверкой оказывается ещё и `columnDefSql`.
 */

const TABLE = 'zz_default_tz_probe';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
});

afterAll(async () => {
  await h.adapter.ddl.raw(`DROP TABLE IF EXISTS "${TABLE}"`);
  await h.adapter.end();
});

const field = (type: string, spec?: Record<string, unknown>): IrField =>
  ({
    type,
    nullable: false,
    unique: false,
    ...(spec ? { spec } : {}),
  }) as unknown as IrField;

const col = (
  name: string,
  dataType: string,
  defaultValue: string | null,
): DbColumn => ({
  name,
  tableName: TABLE,
  dataType,
  isNullable: false,
  defaultValue,
  isPrimary: false,
  isUnique: false,
});

/** Пересоздать таблицу с указанными колонками. */
async function recreate(columns: DbColumn[]): Promise<void> {
  await h.adapter.ddl.raw(`DROP TABLE IF EXISTS "${TABLE}"`);
  await h.adapter.ddl.createTable(TABLE, columns);
}

/**
 * Значения, записанные двумя путями: из DEFAULT и явным параметром.
 *
 * Читается `::text` и `extract(epoch ...)` намеренно, а не «как вернёт
 * драйвер»: `timestamp` и `timestamptz` драйвер разбирает в `Date`, и проверка
 * на разборе замеряла бы форматирование клиента вместо хранимого значения.
 * `::text` показывает календарные поля как они лежат в базе, `epoch` — инстант.
 */
async function defaultVsParam(
  column: string,
  param: unknown,
): Promise<{ fromDefault: string; fromParam: string; epoch: number }> {
  await h.adapter.ddl.raw(`INSERT INTO "${TABLE}" (id) VALUES (1)`);
  await h.adapter.ddl.raw(
    `INSERT INTO "${TABLE}" (id, "${column}") VALUES (2, $1)`,
    [param],
  );
  const rows = (await h.adapter.ddl.raw(
    `SELECT id,
            "${column}"::text AS txt,
            extract(epoch FROM "${column}") AS epoch
       FROM "${TABLE}" ORDER BY id`,
  )) as Array<{ id: number; txt: string; epoch: string }>;
  // `id bigint` разбирается драйвером в number (глобальный int8-парсер),
  // поэтому ключи приводим к строке явно.
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const a = byId.get('1') as { txt: string; epoch: string };
  const b = byId.get('2') as { txt: string; epoch: string };
  return {
    fromDefault: a.txt,
    fromParam: b.txt,
    epoch: Number(a.epoch),
  };
}

describe('DEFAULT vs explicit parameter, under non-UTC TZ', () => {
  it('зона отличается от UTC, иначе проверки ниже не значат ничего', () => {
    // Под UTC старый баг неотличим от корректного поведения: `toISOString()`
    // и локальное время совпадают. Прогон с `TZ=UTC` сделал бы весь файл
    // зелёным на баге, поэтому падать нужно громко и сразу.
    expect(new Date(2024, 0, 1, 9, 30, 0).toISOString()).not.toBe(
      '2024-01-01T09:30:00.000Z',
    );
  });

  it('timestamp: DEFAULT и явный параметр дают одно значение', async () => {
    const d = new Date(2024, 0, 1, 9, 30, 0);
    await recreate([
      col('id', 'bigint', null),
      col(
        'ts',
        'timestamp without time zone',
        renderDefault(field('datetime', { default: d })),
      ),
    ]);

    const { fromDefault, fromParam } = await defaultVsParam('ts', d);
    expect(fromDefault).toBe(fromParam);
    // Sanity: под не-UTC зоной в базе обязано лечь локальное 09:30, а не
    // 00:30 UTC из старого `toISOString()`. Проверяем именно хранимое
    // значение — расхождение тут и было багом.
    expect(fromDefault).toContain('09:30');
  });

  it('timestamptz: DEFAULT и явный параметр дают один инстант', async () => {
    const d = new Date(2024, 0, 1, 9, 30, 0);
    await recreate([
      col('id', 'bigint', null),
      col(
        'tstz',
        'timestamp with time zone',
        renderDefault(field('datetime', { default: d, tz: true })),
      ),
    ]);

    const { fromDefault, fromParam, epoch } = await defaultVsParam('tstz', d);
    expect(fromDefault).toBe(fromParam);
    expect(epoch).toBe(d.getTime() / 1000);
  });

  it('date: DEFAULT и явный параметр дают один календарный день', async () => {
    const d = new Date(2024, 5, 15);
    await recreate([
      col('id', 'bigint', null),
      col('d', 'date', renderDefault(field('date', { default: d }))),
    ]);

    const { fromDefault, fromParam } = await defaultVsParam('d', d);
    expect(fromDefault).toBe(fromParam);
    expect(fromDefault).toBe('2024-06-15');
  });
});

describe('DEFAULT идемпотентен для diff', () => {
  const irsOf = (fields: Record<string, IrField>) => [
    { name: 'ZzDefaultTzProbe', collection: TABLE, fields },
  ];

  const alterDefaults = async (fields: Record<string, IrField>) => {
    const { computeDiff } = await import('@karkardmitry/kadmium-sql-pg');
    const diff = await computeDiff(irsOf(fields), h.adapter.ddl);
    return diff.operations.filter((o) => o.type === 'alter-default');
  };

  const idField = {
    type: 'primary',
    nullable: false,
    unique: true,
    isPrimary: true,
  } as unknown as IrField;

  // Формы дефолтов соответствуют тому, что PostgreSQL реально отдаёт в
  // `information_schema`: с приведением типа и переписанным литералом.
  it('совпадающий дефолт не порождает alter-default', async () => {
    await h.adapter.ddl.raw(`DROP TABLE IF EXISTS "${TABLE}"`);
    await h.adapter.ddl.raw(
      `CREATE TABLE "${TABLE}" (
         id bigserial PRIMARY KEY,
         n integer NOT NULL DEFAULT 0,
         s character varying NOT NULL DEFAULT 'x',
         ts timestamp without time zone NOT NULL DEFAULT '2024-01-01 09:30:00',
         tstz timestamp with time zone NOT NULL DEFAULT '2024-01-01 00:30:00+00',
         d date NOT NULL DEFAULT '2024-06-15'
       )`,
    );

    expect(
      await alterDefaults({
        id: idField,
        n: field('int', { default: 0 }),
        s: field('string', { default: 'x' }),
        ts: field('datetime', { default: '2024-01-01 09:30:00' }),
        // Модель хранит инстант, база — нормализованный литерал в UTC.
        tstz: field('datetime', {
          default: new Date(Date.UTC(2024, 0, 1, 0, 30)),
          tz: true,
        }),
        d: field('date', { default: '2024-06-15' }),
      }),
    ).toEqual([]);
  });

  it('serial-колонка не получает DROP DEFAULT', async () => {
    await h.adapter.ddl.raw(`DROP TABLE IF EXISTS "${TABLE}"`);
    await h.adapter.ddl.raw(
      `CREATE TABLE "${TABLE}" (id bigserial PRIMARY KEY)`,
    );

    // Модель для serial-ожидает null, интроспекция отдаёт nextval(...). Без
    // защиты здесь был бы DROP DEFAULT и сломанный INSERT.
    expect(await alterDefaults({ id: idField })).toEqual([]);
  });

  it('расхождение порождает alter-default в обе стороны', async () => {
    await h.adapter.ddl.raw(`DROP TABLE IF EXISTS "${TABLE}"`);
    await h.adapter.ddl.raw(
      `CREATE TABLE "${TABLE}" (
         id bigserial PRIMARY KEY,
         n integer NOT NULL DEFAULT 1
       )`,
    );

    // SET: модель хочет другой дефолт.
    expect(
      await alterDefaults({ id: idField, n: field('int', { default: 0 }) }),
    ).toEqual([
      {
        type: 'alter-default',
        table: TABLE,
        columnName: 'n',
        oldDefault: '1',
        newDefault: '0',
      },
    ]);

    // DROP: модель не объявляет дефолт вовсе.
    expect(await alterDefaults({ id: idField, n: field('int') })).toEqual([
      {
        type: 'alter-default',
        table: TABLE,
        columnName: 'n',
        oldDefault: '1',
        newDefault: null,
      },
    ]);
  });

  it('применённый alter-default делает схему синхронизированной', async () => {
    await h.adapter.ddl.raw(`DROP TABLE IF EXISTS "${TABLE}"`);
    await h.adapter.ddl.raw(
      `CREATE TABLE "${TABLE}" (
         id bigserial PRIMARY KEY,
         n integer NOT NULL DEFAULT 1
       )`,
    );
    const fields = { id: idField, n: field('int', { default: 0 }) };

    const { computeDiff, applyDiff } =
      await import('@karkardmitry/kadmium-sql-pg');
    const before = await computeDiff(irsOf(fields), h.adapter.ddl);
    expect(before.hasChanges).toBe(true);
    await applyDiff(before, h.adapter.ddl);

    // Повторный diff обязан быть пустым: иначе каждая миграция заново
    // «чинила» бы уже приведённую колонку.
    expect((await computeDiff(irsOf(fields), h.adapter.ddl)).hasChanges).toBe(
      false,
    );
  });
});
