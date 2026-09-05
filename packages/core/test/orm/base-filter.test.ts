import { describe, it, expect } from 'vitest';
import { BaseFilter } from '../../src/orm/field-builders/base-filter';
import { makeSqb } from './helpers';

describe('BaseFilter', () => {
  it('clause() returns correct shape', () => {
    const sqb = makeSqb();
    const filter = new BaseFilter(sqb, 'name', 'u', 'user_name');
    const result = (filter as any).clause('=', 'Alice');

    expect(result).toEqual({
      alias: 'u',
      field: 'name',
      column: 'user_name',
      op: '=',
      value: 'Alice',
    });
  });

  it('clause() without column', () => {
    const sqb = makeSqb();
    const filter = new BaseFilter(sqb, 'name', 'u');
    const result = (filter as any).clause('!=', 'Bob');

    expect(result.column).toBeUndefined();
    expect(result.alias).toBe('u');
    expect(result.field).toBe('name');
  });

  it('getIdentifierForSql with column', () => {
    const sqb = makeSqb();
    const filter = new BaseFilter(sqb, 'name', 'u', 'user_name');
    expect(filter.getIdentifierForSql()).toBe('"u"."user_name"');
  });

  it('getIdentifierForSql without column falls back to field', () => {
    const sqb = makeSqb();
    const filter = new BaseFilter(sqb, 'name', 'u');
    expect(filter.getIdentifierForSql()).toBe('"u"."name"');
  });

  it('constructor stores references', () => {
    const sqb = makeSqb();
    const filter = new BaseFilter(sqb, 'age', 'u', 'user_age');
    expect(filter.sqb).toBe(sqb);
    expect(filter.field).toBe('age');
    expect(filter.alias).toBe('u');
    expect(filter.column).toBe('user_age');
  });
});
