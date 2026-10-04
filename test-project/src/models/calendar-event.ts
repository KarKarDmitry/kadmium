import { Model, f } from '@karkardmitry/kadmium-core';

/**
 * Модель-матрица для времени: четыре колонки в одной таблице, чтобы разница
 * между ними была видна на одном прогоне.
 *
 * - `happenedAt` — `f.datetime`, инстант как местная wall-clock строка
 *   (`timestamp without time zone`)
 * - `happenedAtTz` — `f.datetime.withTimeZone()`, тот же момент, но как
 *   `timestamptz`: PG нормализует в UTC и offset не теряется
 * - `eventDate` / `eventTime` — календарный день и время суток, объявленные
 *   строками (`YYYY-MM-DD` и `HH:MM:SS`). Драйвер отдаёт и принимает строки, а
 *   `Date` для `date` терял календарный день на границе локальной зоны:
 *   '2026-10-02', прочитанное в Asia/Tokyo, давало 2026-10-01T15:00Z.
 *
 * Модель вынесена отдельно от `User`, чтобы смена типа не задевала существующие
 * сиды, а проверки не подменяли друг друга.
 */
export class CalendarEvent extends Model {
  title = f.string;
  happenedAt = f.datetime.notNull();
  happenedAtTz = f.datetime.withTimeZone().notNull();
  eventDate = f.datetime.date.notNull();
  eventTime = f.datetime.time.notNull();
}
