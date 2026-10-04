import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';

describe('DateTimeFieldBuilder', () => {
  it('$build: _type=time, type=datetime, tsType=Date', () => {
    const field = f.datetime.$build();
    expect(field._meta._type).toBe('time');
    expect(field.type).toBe('datetime');
    expect(field.tsType).toBe('Date');
  });

  it('f.datetime.date.$build: type=date', () => {
    const field = f.datetime.date.$build();
    expect(field.type).toBe('date');
  });

  it('f.datetime.time.$build: type=time', () => {
    const field = f.datetime.time.$build();
    expect(field.type).toBe('time');
  });

  it('f.datetime.default() works (no validation on base)', () => {
    const d = new Date('2024-01-15T10:30:00Z');
    const field = f.datetime.default(d).$build();
    expect(field.spec).toEqual({ default: d });
  });

  it('f.datetime.date.default() takes a YYYY-MM-DD string', () => {
    const field = f.datetime.date.default('2024-01-15').$build();
    expect(field.spec).toEqual({ default: '2024-01-15' });
  });

  it('f.datetime.date.default() rejects a Date', () => {
    // Date терял календарный день на границе локальной зоны: '2026-10-02',
    // прочитанное в Asia/Tokyo, давало 2026-10-01T15:00Z. Строка round-trip'ится
    // без потерь, поэтому Date здесь больше не принимается.
    expect(() =>
      // @ts-expect-error Date больше не принимается — это проверка типа, не только рантайма
      f.datetime.date.default(new Date('2024-01-15T00:00:00Z')),
    ).toThrow('Date field "default" value must be a "YYYY-MM-DD" string');
  });

  it.each(['2024-1-5', '2024-01-15T00:00:00Z', '15.01.2024', ''])(
    'f.datetime.date.default() rejects %j',
    (bad) => {
      expect(() => f.datetime.date.default(bad)).toThrow(
        'Date field "default" value must be a "YYYY-MM-DD" string',
      );
    },
  );

  it('f.datetime.time.default() takes an HH:MM:SS string', () => {
    const field = f.datetime.time.default('14:30:00').$build();
    expect(field.spec).toEqual({ default: '14:30:00' });
  });

  it('f.datetime.time.default() accepts milliseconds', () => {
    const field = f.datetime.time.default('14:30:00.123').$build();
    expect(field.spec).toEqual({ default: '14:30:00.123' });
  });

  it('f.datetime.time.default() rejects a Date', () => {
    // Старый контракт требовал Date с датой 1970-01-01 — чужой календарный день
    // в поле, которое хранит только время суток.
    expect(() =>
      // @ts-expect-error Date больше не принимается — это проверка типа, не только рантайма
      f.datetime.time.default(new Date('1970-01-01T14:30:00Z')),
    ).toThrow('Time field "default" value must be an "HH:MM:SS" string');
  });

  it.each(['14:30', '1970-01-01T14:30:00Z', '2:30:00 PM', ''])(
    'f.datetime.time.default() rejects %j',
    (bad) => {
      expect(() => f.datetime.time.default(bad)).toThrow(
        'Time field "default" value must be an "HH:MM:SS" string',
      );
    },
  );

  it('.min().max() sets spec', () => {
    const min = new Date('2024-01-01T00:00:00Z');
    const max = new Date('2024-12-31T23:59:59Z');
    const field = f.datetime.min(min).max(max).$build();
    expect(field.spec).toEqual({ min, max });
  });

  it('f.datetime.date.min().max() take strings', () => {
    const field = f.datetime.date.min('2024-01-01').max('2024-12-31').$build();
    expect(field.spec).toEqual({ min: '2024-01-01', max: '2024-12-31' });
  });

  it('tsType: Date у datetime, string у date и time', () => {
    // Даты и время приходят из драйвера строками, и объявлять их как Date
    // было бы обещанием, которое рантайм не держит (time отдавался строкой, а
    // date — Date в локальной полночи).
    expect(f.datetime.$build().tsType).toBe('Date');
    expect(f.datetime.date.$build().tsType).toBe('string');
    expect(f.datetime.time.$build().tsType).toBe('string');
  });
});
