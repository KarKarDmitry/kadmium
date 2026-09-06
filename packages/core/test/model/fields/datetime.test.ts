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

  it('f.datetime.date.default() works with midnight UTC', () => {
    const d = new Date('2024-01-15T00:00:00Z');
    const field = f.datetime.date.default(d).$build();
    expect(field.spec).toEqual({ default: d });
  });

  it('f.datetime.date.default() throws with time components', () => {
    const d = new Date('2024-01-15T12:00:00Z');
    expect(() => f.datetime.date.default(d)).toThrow(
      'Date field "default" value has time components',
    );
  });

  it('f.datetime.time.default() works with epoch date', () => {
    const d = new Date('1970-01-01T14:30:00Z');
    const field = f.datetime.time.default(d).$build();
    expect(field.spec).toEqual({ default: d });
  });

  it('f.datetime.time.default() throws with non-epoch date', () => {
    const d = new Date('2024-01-15T14:30:00Z');
    expect(() => f.datetime.time.default(d)).toThrow(
      'Time field "default" value has date components',
    );
  });

  it('.min().max() sets spec', () => {
    const min = new Date('2024-01-01T00:00:00Z');
    const max = new Date('2024-12-31T23:59:59Z');
    const field = f.datetime.min(min).max(max).$build();
    expect(field.spec).toEqual({ min, max });
  });

  it('all variants have tsType=Date', () => {
    expect(f.datetime.$build().tsType).toBe('Date');
    expect(f.datetime.date.$build().tsType).toBe('Date');
    expect(f.datetime.time.$build().tsType).toBe('Date');
  });
});
