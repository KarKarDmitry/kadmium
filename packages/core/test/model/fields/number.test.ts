import { describe, it, expect } from 'vitest';
import f from '../../../src/model/fields';

describe('NumberFieldBuilder', () => {
  it('$build: _type=number, type=int, tsType=number', () => {
    const field = f.number.$build();
    expect(field._meta._type).toBe('number');
    expect(field.type).toBe('int');
    expect(field.tsType).toBe('number');
  });

  it('.decimal.$build: type=decimal', () => {
    const field = f.number.decimal.$build();
    expect(field.type).toBe('decimal');
  });

  it('.default(5) works for integer', () => {
    const field = f.number.default(5).$build();
    expect(field.spec).toEqual({ default: 5 });
  });

  it('.default(5.5) throws for integer field', () => {
    expect(() => f.number.default(5.5)).toThrow(
      'IntegerField default must be an integer',
    );
  });

  it('.default(NaN) throws', () => {
    expect(() => f.number.default(NaN)).toThrow(
      'IntegerField default must be an integer',
    );
  });

  it('.default(Infinity) throws', () => {
    expect(() => f.number.default(Infinity)).toThrow(
      'IntegerField default must be an integer',
    );
  });

  it('.default(0) works (edge case)', () => {
    const field = f.number.default(0).$build();
    expect(field.spec).toEqual({ default: 0 });
  });

  it('.default(-1.0) works (negative integer)', () => {
    const field = f.number.default(-1).$build();
    expect(field.spec).toEqual({ default: -1 });
  });

  it('decimal.default(5.5) works (no integer check)', () => {
    const field = f.number.decimal.default(5.5).$build();
    expect(field.spec).toEqual({ default: 5.5 });
  });

  it('.min().max() sets spec', () => {
    const field = f.number.min(0).max(100).$build();
    expect(field.spec).toEqual({ min: 0, max: 100 });
  });
});
