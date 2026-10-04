import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { pgDialect } from '@karkardmitry/kadmium-sql-pg';
import { CalendarEvent } from '../../../src/models';
import { makeHarness, type Harness } from '../../helpers';

/**
 * `date` и `time` — строки, а не `Date`.
 *
 * Проверяем не типы (они проверяются компилятором), а что значение доезжает
 * до БД и возвращается тем же самым. Раньше `date` объявлялся как `Date`, и
 * тест на точность проходил только на локальной машине: зависел от TZ процесса.
 */
let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  await h.adapter.ddl.raw('DELETE FROM "calendar_event"');
});

afterAll(async () => {
  await h.adapter.end();
});

async function insertEvent(
  over: Partial<{
    title: string;
    happenedAt: Date;
    happenedAtTz: Date;
    eventDate: string;
    eventTime: string;
  }> = {},
) {
  const happenedAt = over.happenedAt ?? new Date('2024-06-15T14:30:45.123Z');
  return h.orm
    .insert(CalendarEvent)
    .values({
      title: over.title ?? 'evt',
      happenedAt,
      // Тот же инстант в обоих колонках: разница только в хранении, и её видно
      // на чтении — `timestamptz` нормализован в UTC.
      happenedAtTz: over.happenedAtTz ?? happenedAt,
      eventDate: over.eventDate ?? '2024-06-15',
      eventTime: over.eventTime ?? '14:30:45.123',
    })
    .go();
}

describe('date/time: значение доезжает строкой и возвращается тем же', () => {
  it('insert() возвращает eventDate и eventTime строками', async () => {
    const row = await insertEvent({ title: 'strings' });

    expect(typeof row.eventDate).toBe('string');
    expect(typeof row.eventTime).toBe('string');
    expect(row.eventDate).toBe('2024-06-15');
    expect(row.eventTime).toBe('14:30:45.123');
  });

  it('select() отдаёт те же строки, а не Date', async () => {
    const created = await insertEvent({ title: 'read-back' });

    const [found] = await h.orm
      .select(CalendarEvent)
      .where((e) => e.id.eq(created.id))
      .go();

    expect(found.eventDate).toBe('2024-06-15');
    expect(found.eventTime).toBe('14:30:45.123');
    // Регрессия против старого поведения: парсер oid 1082 строил Date в
    // локальной зоне, и календарный день оттуда терялся.
    expect(found.eventDate).not.toBeInstanceOf(Date);
  });

  it('happenedAt остаётся Date — datetime не тронут', async () => {
    const ts = new Date('2024-06-15T14:30:45.123Z');
    const row = await insertEvent({ title: 'instant', happenedAt: ts });

    expect(row.happenedAt).toBeInstanceOf(Date);
    expect((row.happenedAt as Date).getTime()).toBe(ts.getTime());
  });

  it('withTimeZone(): инстант доезжает и возвращается с точностью до мс', async () => {
    const ts = new Date('2024-06-15T14:30:45.123Z');
    const row = await insertEvent({ title: 'tz', happenedAtTz: ts });

    expect(row.happenedAtTz).toBeInstanceOf(Date);
    expect((row.happenedAtTz as Date).getTime()).toBe(ts.getTime());
  });

  it('withTimeZone(): колонка объявлена timestamptz, а datetime — timestamp', async () => {
    const columns = (await h.adapter.ddl.raw(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'calendar_event'
         AND column_name IN ('happenedAt', 'happenedAtTz')`,
    )) as unknown as Array<{ column_name: string; data_type: string }>;
    const byName = new Map(columns.map((c) => [c.column_name, c.data_type]));

    // Длинная форма обязательна: интроспекция вернёт именно её, а
    // normalizePgType не схлопывает 'with' в короткое имя.
    expect(byName.get('happenedAt')).toBe('timestamp without time zone');
    expect(byName.get('happenedAtTz')).toBe('timestamp with time zone');
  });

  it('withTimeZone(): повторный db:push не предлагает alter-type', async () => {
    const { computeDiff } = await import('@karkardmitry/kadmium-core');

    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl, pgDialect);
    const altering = diff.operations.filter((op) => op.type === 'alter-type');

    // Тип из IR и тип из интроспекции обязаны совпадать, иначе каждая миграция
    // предлагала бы «починить» уже правильную колонку.
    expect(altering).toEqual([]);
  });

  it('календарный день не смещается: 2026-10-02 остаётся 2026-10-02', async () => {
    // Дата, которую нельзя спутать при переходе через полночь по UTC.
    const row = await insertEvent({ title: 'edge', eventDate: '2026-10-02' });

    const [found] = await h.orm
      .select(CalendarEvent)
      .where((e) => e.id.eq(row.id))
      .go();

    expect(found.eventDate).toBe('2026-10-02');
  });

  it('полноночь и конец года переживают round-trip', async () => {
    const row = await insertEvent({
      title: 'edges',
      eventDate: '2026-12-31',
      eventTime: '00:00:00',
    });

    const [found] = await h.orm
      .select(CalendarEvent)
      .where((e) => e.id.eq(row.id))
      .go();

    expect(found.eventDate).toBe('2026-12-31');
    expect(found.eventTime).toBe('00:00:00');
  });
});

describe('date/time: фильтры сравнивают строки', () => {
  it('gt/lt на date выбирают по календарному дню', async () => {
    const before = await insertEvent({
      title: 'before',
      eventDate: '2024-06-01',
    });
    const after = await insertEvent({
      title: 'after',
      eventDate: '2024-07-01',
    });

    const rows = await h.orm
      .select(CalendarEvent)
      .where((e) => e.eventDate.gt('2024-06-15'))
      .go();

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(after.id);
    expect(ids).not.toContain(before.id);
  });

  it('between на time работает по строковому порядку', async () => {
    const early = await insertEvent({
      title: 'early',
      eventTime: '09:00:00',
    });
    const noon = await insertEvent({ title: 'noon', eventTime: '12:00:00' });

    const rows = await h.orm
      .select(CalendarEvent)
      .where((e) => e.eventTime.between('10:00:00', '18:00:00'))
      .go();

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(noon.id);
    expect(ids).not.toContain(early.id);
  });

  it('in() на date принимает список строк', async () => {
    const target = await insertEvent({
      title: 'in-target',
      eventDate: '2024-08-08',
    });

    const rows = await h.orm
      .select(CalendarEvent)
      .where((e) => e.eventDate.in(['2024-08-08', '2024-08-09']))
      .go();

    expect(rows.map((r) => r.id)).toContain(target.id);
  });
});

describe('date/time: update меняет значение', () => {
  it('set() пишет новую дату, и она же читается', async () => {
    const row = await insertEvent({ title: 'to-update' });

    const [updated] = await h.orm
      .update(CalendarEvent)
      .set({ eventDate: '2026-01-31', eventTime: '23:59:59' })
      .where((e) => e.id.eq(row.id))
      .returning((e) => [e.eventDate, e.eventTime])
      .go();

    expect(updated.eventDate).toBe('2026-01-31');
    expect(updated.eventTime).toBe('23:59:59');
  });
});
