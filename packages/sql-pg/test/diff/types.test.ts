import { describe, it, expect } from 'vitest';
import {
  pgType,
  normalizePgType,
  renderDefault,
  defaultsEqual,
} from '../../src/diff/types';
import type { IrField, IrModel } from '@karkardmitry/kadmium-sql-types';

const fld = (type: string, spec?: Record<string, unknown>): IrField => ({
  type,
  nullable: false,
  unique: false,
  spec,
});

const irs: IrModel[] = [
  {
    name: 'User',
    collection: 'users',
    fields: {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      name: { type: 'string', nullable: false, unique: false },
    },
  },
  {
    name: 'Post',
    collection: 'posts',
    fields: {
      id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
      title: { type: 'string', nullable: false, unique: false },
      author: { type: 'ref', ref: 'User', nullable: false, unique: false },
    },
  },
];

describe('pgType', () => {
  it('primary → integer by default', () => {
    expect(pgType({ type: 'primary', nullable: false, unique: true }, [])).toBe(
      'integer',
    );
  });

  it('primary with uuid db_type → uuid', () => {
    expect(
      pgType(
        {
          type: 'primary',
          nullable: false,
          unique: true,
          spec: { db_type: 'uuid' },
        },
        [],
      ),
    ).toBe('uuid');
  });

  it('primary with string db_type → varchar', () => {
    expect(
      pgType(
        {
          type: 'primary',
          nullable: false,
          unique: true,
          spec: { db_type: 'string' },
        },
        [],
      ),
    ).toBe('character varying');
  });

  it('primary with numeric db_type → numeric', () => {
    expect(
      pgType(
        {
          type: 'primary',
          nullable: false,
          unique: true,
          spec: { db_type: 'numeric' },
        },
        [],
      ),
    ).toBe('numeric');
  });

  it('ref resolves to target PK type', () => {
    const f: IrField = {
      type: 'ref',
      ref: 'User',
      nullable: false,
      unique: false,
    };
    expect(pgType(f, irs)).toBe('integer');
  });

  it('ref with unknown target falls through', () => {
    const f: IrField = {
      type: 'ref',
      ref: 'Unknown',
      nullable: false,
      unique: false,
    };
    expect(pgType(f, irs)).toBe('text');
  });

  it('string → varchar', () => {
    expect(pgType({ type: 'string', nullable: false, unique: false }, [])).toBe(
      'character varying',
    );
  });

  it('number → integer', () => {
    expect(pgType({ type: 'number', nullable: false, unique: false }, [])).toBe(
      'integer',
    );
  });

  // `time` и `datetime` — разные колонки. Раньше `time` уезжал в `timestamp`,
  // и значение вроде '14:30:45.123' отвергалось PG (22007) как timestamp.
  it('time → time without time zone', () => {
    expect(pgType({ type: 'time', nullable: false, unique: false }, [])).toBe(
      'time without time zone',
    );
  });

  // Длинная форма, а не 'timestamptz': у normalizePgType нет ветки-коллапсера
  // для `with`, поэтому короткое имя не сошлось бы с интроспекцией и давало бы
  // бесконечный alter-type.
  it('datetime with spec.tz → timestamp with time zone', () => {
    expect(
      pgType(
        {
          type: 'datetime',
          nullable: false,
          unique: false,
          spec: { tz: true },
        },
        [],
      ),
    ).toBe('timestamp with time zone');
  });

  it('spec.tz игнорируется для не-datetime типов', () => {
    expect(
      pgType(
        { type: 'date', nullable: false, unique: false, spec: { tz: true } },
        [],
      ),
    ).toBe('date');
  });

  it('int → integer', () => {
    expect(pgType({ type: 'int', nullable: false, unique: false }, [])).toBe(
      'integer',
    );
  });

  it('bigint → bigint', () => {
    expect(pgType({ type: 'bigint', nullable: false, unique: false }, [])).toBe(
      'bigint',
    );
  });

  it('decimal → numeric', () => {
    expect(
      pgType({ type: 'decimal', nullable: false, unique: false }, []),
    ).toBe('numeric');
  });

  it('float → double precision', () => {
    expect(pgType({ type: 'float', nullable: false, unique: false }, [])).toBe(
      'double precision',
    );
  });

  it('boolean → boolean', () => {
    expect(
      pgType({ type: 'boolean', nullable: false, unique: false }, []),
    ).toBe('boolean');
  });

  it('date → date', () => {
    expect(pgType({ type: 'date', nullable: false, unique: false }, [])).toBe(
      'date',
    );
  });

  it('datetime → timestamp', () => {
    expect(
      pgType({ type: 'datetime', nullable: false, unique: false }, []),
    ).toBe('timestamp without time zone');
  });

  // Не `timestamp`: время суток — отдельная колонка. Схлопывание в timestamp
  // давало PG 22007 на '14:30:45.123' и тихий `db:push` без alter-type.
  it('time → time without time zone (не timestamp)', () => {
    expect(pgType({ type: 'time', nullable: false, unique: false }, [])).toBe(
      'time without time zone',
    );
  });

  it('uuid → uuid', () => {
    expect(pgType({ type: 'uuid', nullable: false, unique: false }, [])).toBe(
      'uuid',
    );
  });

  it('unknown type → text', () => {
    expect(pgType({ type: 'jsonb', nullable: false, unique: false }, [])).toBe(
      'text',
    );
  });
});

describe('normalizePgType', () => {
  it('character varying → varchar', () => {
    expect(normalizePgType('character varying')).toBe('varchar');
  });

  it('timestamp without time zone → timestamp', () => {
    expect(normalizePgType('timestamp without time zone')).toBe('timestamp');
  });

  it('time without time zone → time', () => {
    expect(normalizePgType('time without time zone')).toBe('time');
  });

  it('double precision → float8', () => {
    expect(normalizePgType('double precision')).toBe('float8');
  });

  it('integer → integer', () => {
    expect(normalizePgType('integer')).toBe('integer');
  });

  it('int4 → integer', () => {
    expect(normalizePgType('int4')).toBe('integer');
  });

  it('varchar(255) → varchar', () => {
    expect(normalizePgType('varchar(255)')).toBe('varchar');
  });

  it('numeric → numeric', () => {
    expect(normalizePgType('numeric')).toBe('numeric');
  });

  it('decimal → numeric', () => {
    expect(normalizePgType('decimal')).toBe('numeric');
  });

  it('bigint → bigint', () => {
    expect(normalizePgType('bigint')).toBe('bigint');
  });

  it('case insensitive', () => {
    expect(normalizePgType('VARCHAR')).toBe('varchar');
  });
});

describe('renderDefault', () => {
  it('no default → null', () => {
    expect(
      renderDefault({ type: 'string', nullable: false, unique: false }),
    ).toBeNull();
  });

  it('boolean true', () => {
    expect(
      renderDefault({
        type: 'boolean',
        nullable: false,
        unique: false,
        spec: { default: true },
      }),
    ).toBe('true');
  });

  it('boolean false', () => {
    expect(
      renderDefault({
        type: 'boolean',
        nullable: false,
        unique: false,
        spec: { default: 'false' },
      }),
    ).toBe('false');
  });

  it('number default', () => {
    expect(
      renderDefault({
        type: 'number',
        nullable: false,
        unique: false,
        spec: { default: 42 },
      }),
    ).toBe('42');
  });

  it('string default with single quote escape', () => {
    expect(
      renderDefault({
        type: 'string',
        nullable: false,
        unique: false,
        spec: { default: "O'Brien" },
      }),
    ).toBe("'O''Brien'");
  });

  it('string default with backslash escape', () => {
    expect(
      renderDefault({
        type: 'string',
        nullable: false,
        unique: false,
        spec: { default: 'path\\to\\file' },
      }),
    ).toBe("'path\\\\to\\\\file'");
  });

  it('string default with backslash and single quote', () => {
    expect(
      renderDefault({
        type: 'string',
        nullable: false,
        unique: false,
        spec: { default: "it's a \\path" },
      }),
    ).toBe("'it''s a \\\\path'");
  });

  it('uuid default', () => {
    expect(
      renderDefault({
        type: 'uuid',
        nullable: false,
        unique: false,
        spec: { default: 'abc-123' },
      }),
    ).toBe("'abc-123'");
  });

  // Даты собираются из ЛОКАЛЬНЫХ компонентов: литерал тогда одинаков в любом
  // TZ, и тест ловит возврат к `toISOString()` по форме даже под UTC.
  it('datetime with Date object → локальный wall-clock, без офсета', () => {
    const d = new Date(2024, 0, 15, 14, 30, 45, 123);
    expect(
      renderDefault({
        type: 'datetime',
        nullable: false,
        unique: false,
        spec: { default: d },
      }),
    ).toBe("'2024-01-15 14:30:45.123'");
  });

  // `timestamptz` хранит инстант: `Z` обязателен, иначе значение разберётся в
  // `TimeZone` сервера, а не клиента.
  it('datetime with spec.tz → инстант в UTC, а не локальное время', () => {
    const d = new Date(2024, 0, 15, 14, 30, 45, 123);
    expect(
      renderDefault({
        type: 'datetime',
        nullable: false,
        unique: false,
        spec: { default: d, tz: true },
      }),
    ).toBe(`'${d.toISOString()}'`);
  });

  it('spec.tz и без него дают разные литералы', () => {
    const d = new Date(2024, 0, 15, 14, 30, 45, 123);
    const base = {
      type: 'datetime' as const,
      nullable: false,
      unique: false,
    };
    const wall = renderDefault({ ...base, spec: { default: d } });
    const instant = renderDefault({ ...base, spec: { default: d, tz: true } });
    expect(wall).not.toBe(instant);
  });

  it('date with Date object → локальный календарный день', () => {
    expect(
      renderDefault({
        type: 'date',
        nullable: false,
        unique: false,
        spec: { default: new Date(2024, 5, 15) },
      }),
    ).toBe("'2024-06-15'");
  });

  it('time with Date object → локальное время суток', () => {
    expect(
      renderDefault({
        type: 'time',
        nullable: false,
        unique: false,
        spec: { default: new Date(2024, 0, 15, 14, 30, 45, 123) },
      }),
    ).toBe("'14:30:45.123'");
  });

  it('date/time со строковым дефолтом проходят как есть', () => {
    expect(
      renderDefault({
        type: 'date',
        nullable: false,
        unique: false,
        spec: { default: '2024-06-15' },
      }),
    ).toBe("'2024-06-15'");
    expect(
      renderDefault({
        type: 'time',
        nullable: false,
        unique: false,
        spec: { default: '14:30:45' },
      }),
    ).toBe("'14:30:45'");
  });

  it('datetime with string', () => {
    expect(
      renderDefault({
        type: 'datetime',
        nullable: false,
        unique: false,
        spec: { default: '2024-01-15' },
      }),
    ).toBe("'2024-01-15'");
  });

  it('datetime with single quote escape', () => {
    expect(
      renderDefault({
        type: 'datetime',
        nullable: false,
        unique: false,
        spec: { default: "it's now" },
      }),
    ).toBe("'it''s now'");
  });

  it('date with single quote escape', () => {
    expect(
      renderDefault({
        type: 'date',
        nullable: false,
        unique: false,
        spec: { default: "it's today" },
      }),
    ).toBe("'it''s today'");
  });
});

/**
 * Формы в правой колонке — не выдумки, а то, что PostgreSQL реально отдаёт в
 * `information_schema.columns.column_default` (проверено на живой базе).
 */
describe('defaultsEqual', () => {
  const fld = (type: string, spec?: Record<string, unknown>): IrField =>
    ({
      type,
      nullable: false,
      unique: false,
      ...(spec ? { spec } : {}),
    }) as unknown as IrField;

  it('null совпадает только с null', () => {
    expect(defaultsEqual(fld('int'), null, null)).toBe(true);
    expect(defaultsEqual(fld('int'), null, '0')).toBe(false);
    expect(defaultsEqual(fld('int'), '5', null)).toBe(false);
  });

  it('голое число и есть число — без приведения типа', () => {
    expect(defaultsEqual(fld('int'), '0', '0')).toBe(true);
    expect(defaultsEqual(fld('bigint'), '10', '10')).toBe(true);
    expect(defaultsEqual(fld('numeric'), '5.5', '5.5')).toBe(true);
    expect(defaultsEqual(fld('int'), '5', '0')).toBe(false);
  });

  it('boolean совпадает буквально', () => {
    expect(defaultsEqual(fld('boolean'), 'true', 'true')).toBe(true);
    expect(defaultsEqual(fld('boolean'), 'false', 'true')).toBe(false);
  });

  it('строковый литерал без каста совпадает с кастованным', () => {
    expect(
      defaultsEqual(fld('string'), "'hello'", "'hello'::character varying"),
    ).toBe(true);
    expect(defaultsEqual(fld('string'), "''", "''::character varying")).toBe(
      true,
    );
    expect(
      defaultsEqual(fld('string'), "'hello'", "'other'::character varying"),
    ).toBe(false);
  });

  it('uuid: снимается ::uuid', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    expect(defaultsEqual(fld('uuid'), `'${uuid}'`, `'${uuid}'::uuid`)).toBe(
      true,
    );
  });

  it('timestamp: снимается ::timestamp without time zone', () => {
    expect(
      defaultsEqual(
        fld('datetime'),
        "'2024-01-15 14:30:45.123'",
        "'2024-01-15 14:30:45.123'::timestamp without time zone",
      ),
    ).toBe(true);
    expect(
      defaultsEqual(
        fld('datetime'),
        "'2024-01-15 14:30:45.123'",
        "'2024-01-15 09:30:45.123'::timestamp without time zone",
      ),
    ).toBe(false);
  });

  it('date/time: снимается ::date и ::time without time zone', () => {
    expect(
      defaultsEqual(fld('date'), "'2024-06-15'", "'2024-06-15'::date"),
    ).toBe(true);
    expect(
      defaultsEqual(
        fld('time'),
        "'14:30:45.123'",
        "'14:30:45.123'::time without time zone",
      ),
    ).toBe(true);
  });

  // Главный случай: PostgreSQL переписывает литерал timestamptz в свой формат,
  // поэтому наш `DEFAULT` никогда не совпадёт с интроспекцией буквально. Без
  // сравнения по инстанту каждая миграция предлагала бы «починить» колонку.
  it('timestamptz: Z и +00 — один и тот же инстант', () => {
    expect(
      defaultsEqual(
        fld('datetime', { tz: true }),
        "'2024-01-01T00:00:00.000Z'",
        "'2024-01-01 00:00:00+00'::timestamp with time zone",
      ),
    ).toBe(true);
  });

  it('timestamptz: другой инстант не считается совпадением', () => {
    expect(
      defaultsEqual(
        fld('datetime', { tz: true }),
        "'2024-01-01T00:00:00.000Z'",
        "'2024-01-02 00:00:00+00'::timestamp with time zone",
      ),
    ).toBe(false);
  });

  it('timestamptz: неразбираемое значение не превращается в NaN-сравнение', () => {
    expect(
      defaultsEqual(
        fld('datetime', { tz: true }),
        "'2024-01-01T00:00:00.000Z'",
        "'garbage'::timestamp with time zone",
      ),
    ).toBe(false);
  });

  it('вложенные приведения типа снимаются все', () => {
    expect(
      defaultsEqual(fld('string'), "'x'", "'x'::text::character varying"),
    ).toBe(true);
  });

  it('внешние скобки снимаются', () => {
    expect(
      defaultsEqual(
        fld('datetime'),
        "'2024-01-15 14:30:45.123'",
        "('2024-01-15 14:30:45.123'::timestamp without time zone)",
      ),
    ).toBe(true);
  });

  it('экранированная кавычка не делает строки равными разным значениям', () => {
    expect(defaultsEqual(fld('string'), "'it''s'", "'it''s'")).toBe(true);
    expect(defaultsEqual(fld('string'), "'it''s'", "'its'")).toBe(false);
  });
});
