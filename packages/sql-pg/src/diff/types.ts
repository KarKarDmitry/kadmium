/**
 * PostgreSQL-специфичная часть миграции: имена типов и `DEFAULT`.
 *
 * Реализация методов `Dialect`. Всё, что не зависит от того, какая база под
 * миграцией, живёт в `core/src/diff/expected.ts`.
 */

import type { IrField, IrModel } from '@karkardmitry/kadmium-sql-types';

/* ── IR field type → PG data type ── */

export function pgType(f: IrField, irs: readonly IrModel[]): string {
  const dbType = f.spec?.db_type as string | undefined;
  if (f.type === 'primary') {
    if (dbType === 'uuid') return 'uuid';
    if (dbType === 'string') return 'character varying';
    if (dbType === 'numeric') return 'numeric';
    return 'integer';
  }
  if (f.type === 'ref' && f.ref) {
    const target = irs.find(
      (m) => m.name.toLowerCase() === f.ref!.toLowerCase(),
    );
    if (target) {
      // Инлайн предиката, а не импорт `isPrimaryField()` из core: адаптер не
      // должен знать про core. Двойник живёт в `core/src/diff/expected.ts` —
      // условие намеренно совпадает, при изменении править оба.
      const pkField = Object.values(target.fields).find(
        (pf) => pf.isPrimary === true || pf.type === 'primary',
      );
      if (pkField) return pgType(pkField, irs);
    }
  }
  if (f.type === 'string') return 'character varying';
  if (f.type === 'number') return 'integer';
  if (f.type === 'int') return 'integer';
  if (f.type === 'bigint') return 'bigint';
  if (f.type === 'decimal' || f.type === 'numeric') return 'numeric';
  if (f.type === 'float') return 'double precision';
  if (f.type === 'boolean') return 'boolean';
  if (f.type === 'date') return 'date';
  if (f.type === 'datetime') {
    // `withTimeZone()` помечается флагом в spec, а не отдельным IR-типом.
    // Длинная форма обязательна: интроспекция вернёт именно её
    // (`timestamp with time zone`), а у `normalizePgType` нет ветки-коллапсера
    // для `with` — короткая запись дала бы бесконечный alter-type.
    return f.spec?.tz
      ? 'timestamp with time zone'
      : 'timestamp without time zone';
  }
  // `time` — время суток, а не инстант. Раньше оно уезжало в
  // `timestamp without time zone`, и колонка `time` не создавалась вовсе: в
  // базу уходил `timestamp`, а PG отвергал '14:30:45.123' с 22007.
  if (f.type === 'time') return 'time without time zone';
  if (f.type === 'uuid') return 'uuid';
  return 'text';
}

/** Normalize PG type for comparison */
export function normalizePgType(type: string): string {
  const t = type.toLowerCase().trim();
  if (t === 'character varying') return 'varchar';
  if (t === 'timestamp without time zone') return 'timestamp';
  if (t === 'time without time zone') return 'time';
  if (t === 'double precision') return 'float8';
  if (t === 'integer' || t === 'int' || t === 'int4') return 'integer';
  if (t.startsWith('varchar')) return 'varchar';
  if (t === 'numeric' || t === 'decimal') return 'numeric';
  if (t === 'bigint') return 'bigint';
  return t;
}

/* ── IR → columns helper ── */

/**
 * Локальный wall-clock в виде, который понимает PostgreSQL.
 *
 * Формат повторяет `pg`'s `dateToString` (`pg/lib/utils.js:85`) — намеренно без
 * офсета: колонка `timestamp without time zone` означает местное время, а PG
 * офсет в такой колонке всё равно игнорирует. Если писать офсет, он будет
 * молча выброшен, а `DEFAULT` и параметр разойдутся при первом же переводе
 * часов.
 *
 * Связано с дефолтом `pg.defaults.parseInputDatesAsUTC = false`: включишь его —
 * и параметры поедут в UTC, а эта функция останется локальной.
 */
function formatLocalTimestamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

/** `YYYY-MM-DD` по локальному календарю — календарный день без времени. */
function formatLocalDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `HH:MM:SS.SSS` по локальным часам. */
function formatLocalTime(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * `timestamptz` хранит инстант, а не wall-clock, поэтому его `DEFAULT` обязан
 * быть инстантом: `toISOString()` даёт `Z`, и PostgreSQL нормализует его в
 * UTC. Локальное время без офсета здесь было бы ошибкой — его разобрали бы в
 * `TimeZone` сервера, а не клиента.
 */
function formatInstant(d: Date): string {
  return d.toISOString();
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Рендерит default-значение как корректный SQL-литерал по типу поля. */
export function renderDefault(f: IrField): string | null {
  const value = f.spec?.default;
  if (value === undefined || value === null) return null;
  const isDate = value instanceof Date;
  switch (f.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'true' : 'false';
    case 'number':
    case 'int':
    case 'bigint':
    case 'decimal':
    case 'float':
    case 'numeric':
      return String(value);
    // `date` и `time` — строки (`YYYY-MM-DD`, `HH:MM:SS[.sss]`). `Date` сюда
    // попадает только от JS-вызывающего, минуя типы: берём локальные
    // компоненты, иначе в `date`-колонку уехал бы инстант.
    case 'date':
      return quoteLiteral(isDate ? formatLocalDate(value) : String(value));
    case 'time':
      return quoteLiteral(isDate ? formatLocalTime(value) : String(value));
    case 'datetime':
      if (isDate) {
        return quoteLiteral(
          f.spec?.tz ? formatInstant(value) : formatLocalTimestamp(value),
        );
      }
      return quoteLiteral(String(value));
    case 'string':
    case 'uuid':
    default:
      return quoteLiteral(String(value));
  }
}

/**
 * Снимает обвязку, которую PostgreSQL добавляет при хранении `DEFAULT`.
 *
 * `information_schema.columns.column_default` — это не то, что мы написали, а
 * результат разбора PG: к нашим литералам она дописывает приведение типа
 * (`'hello'::character varying`), а литералы временных типов переписывает в
 * свой формат (`'2024-01-01T00:00:00.000Z'` → `'2024-01-01 00:00:00+00'`).
 * Без такой нормализации любое сравнение строк порождало бы бесконечный
 * `alter-default`.
 *
 * Срезается только хвост `::type` (возможно, вложенный — `'x'::text::varchar`)
 * и внешние скобки. Внутренние скобки и содержимое литерала не трогаются.
 */
function stripDefaultDecorations(raw: string): string {
  let s = raw.trim();
  // Внешние скобки: PG ставит их, когда в выражении есть приведение типа.
  while (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).trim();
  }
  // Хвост `::type` — с конца, innermost-первым: `'x'::text::character varying`.
  for (;;) {
    const m = /^(.*)::[A-Za-z_][A-Za-z0-9_ ]*(?:\([^()]*\))?$/.exec(s);
    if (!m) break;
    s = m[1].trim();
  }
  return s;
}

/** `'abc'` → `abc`; числа и `true`/`false` не трогает. */
function unquoteDefault(s: string): string {
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

/**
 * Совпадают ли дефолты по смыслу, а не по тексту.
 *
 * Для `timestamptz` строковое равенство невозможно в принципе: PostgreSQL
 * переписывает литерал в свой формат, и наш `DEFAULT` никогда не совпадёт с
 * интроспекцией буквально. Поэтому инстанты сравниваются через `Date.parse` —
 * это единственный способ понять, что `'...Z'` и `'...+00'` одно и то же
 * значение.
 */
export function defaultsEqual(
  f: IrField,
  expected: string | null,
  actual: string | null,
): boolean {
  if (expected === null || actual === null) return expected === actual;
  const ours = unquoteDefault(stripDefaultDecorations(expected));
  const theirs = unquoteDefault(stripDefaultDecorations(actual));
  if (ours === theirs) return true;
  if (f.type === 'datetime' && f.spec?.tz) {
    const a = Date.parse(ours);
    const b = Date.parse(theirs);
    return !Number.isNaN(a) && a === b;
  }
  return false;
}
