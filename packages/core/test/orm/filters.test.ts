import { describe, it, expect } from 'vitest';
import {
  StringFilter,
  NumberFilter,
  BooleanFilter,
  DateFilter,
  addNullable,
} from '../../src/orm/field-builders/filters';
import { makeSqb } from './helpers';

function sqb() {
  return makeSqb();
}

describe('StringFilter', () => {
  it('eq', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.eq('Alice')).toEqual({ alias: 'u', field: 'name', column: undefined, op: '=', value: 'Alice' });
  });
  it('neq', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.neq('Bob')).toEqual({ alias: 'u', field: 'name', column: undefined, op: '!=', value: 'Bob' });
  });
  it('like wraps with %', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.like('Ali')).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'LIKE', value: '%Ali%' });
  });
  it('ilike wraps with %', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.ilike('ali')).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'ILIKE', value: '%ali%' });
  });
  it('start wraps trailing %', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.start('Al')).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'LIKE', value: 'Al%' });
  });
  it('istart wraps trailing %', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.istart('al')).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'ILIKE', value: 'al%' });
  });
  it('end wraps leading %', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.end('ce')).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'LIKE', value: '%ce' });
  });
  it('iend wraps leading %', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.iend('ce')).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'ILIKE', value: '%ce' });
  });
  it('in returns array', () => {
    const f = new StringFilter(sqb(), 'name', 'u');
    expect(f.in(['Alice', 'Bob'])).toEqual({ alias: 'u', field: 'name', column: undefined, op: 'IN', value: ['Alice', 'Bob'] });
  });
});

describe('NumberFilter', () => {
  it('eq', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.eq(25)).toEqual({ alias: 'u', field: 'age', column: undefined, op: '=', value: 25 });
  });
  it('neq', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.neq(30)).toEqual({ alias: 'u', field: 'age', column: undefined, op: '!=', value: 30 });
  });
  it('gt', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.gt(18)).toEqual({ alias: 'u', field: 'age', column: undefined, op: '>', value: 18 });
  });
  it('gte', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.gte(18)).toEqual({ alias: 'u', field: 'age', column: undefined, op: '>=', value: 18 });
  });
  it('lt', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.lt(65)).toEqual({ alias: 'u', field: 'age', column: undefined, op: '<', value: 65 });
  });
  it('lte', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.lte(65)).toEqual({ alias: 'u', field: 'age', column: undefined, op: '<=', value: 65 });
  });
  it('between', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.between(18, 65)).toEqual({ alias: 'u', field: 'age', column: undefined, op: 'BETWEEN', value: [18, 65] });
  });
  it('in', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    expect(f.in([18, 25, 30])).toEqual({ alias: 'u', field: 'age', column: undefined, op: 'IN', value: [18, 25, 30] });
  });
});

describe('BooleanFilter', () => {
  it('eq true', () => {
    const f = new BooleanFilter(sqb(), 'active', 'u');
    expect(f.eq(true)).toEqual({ alias: 'u', field: 'active', column: undefined, op: '=', value: true });
  });
  it('eq false', () => {
    const f = new BooleanFilter(sqb(), 'active', 'u');
    expect(f.eq(false)).toEqual({ alias: 'u', field: 'active', column: undefined, op: '=', value: false });
  });
  it('neq', () => {
    const f = new BooleanFilter(sqb(), 'active', 'u');
    expect(f.neq(true)).toEqual({ alias: 'u', field: 'active', column: undefined, op: '!=', value: true });
  });
  it('true()', () => {
    const f = new BooleanFilter(sqb(), 'active', 'u');
    expect(f.true()).toEqual({ alias: 'u', field: 'active', column: undefined, op: '=', value: true });
  });
  it('false()', () => {
    const f = new BooleanFilter(sqb(), 'active', 'u');
    expect(f.false()).toEqual({ alias: 'u', field: 'active', column: undefined, op: '=', value: false });
  });
});

describe('DateFilter', () => {
  const d1 = new Date('2024-01-01');
  const d2 = new Date('2024-12-31');

  it('eq', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.eq(d1)).toEqual({ alias: 'u', field: 'created', column: undefined, op: '=', value: d1 });
  });
  it('neq', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.neq(d1)).toEqual({ alias: 'u', field: 'created', column: undefined, op: '!=', value: d1 });
  });
  it('after', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.after(d1)).toEqual({ alias: 'u', field: 'created', column: undefined, op: '>', value: d1 });
  });
  it('afterEq', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.afterEq(d1)).toEqual({ alias: 'u', field: 'created', column: undefined, op: '>=', value: d1 });
  });
  it('before', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.before(d2)).toEqual({ alias: 'u', field: 'created', column: undefined, op: '<', value: d2 });
  });
  it('beforeEq', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.beforeEq(d2)).toEqual({ alias: 'u', field: 'created', column: undefined, op: '<=', value: d2 });
  });
  it('between', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.between(d1, d2)).toEqual({ alias: 'u', field: 'created', column: undefined, op: 'BETWEEN', value: [d1, d2] });
  });
  it('in', () => {
    const f = new DateFilter(sqb(), 'created', 'u');
    expect(f.in([d1, d2])).toEqual({ alias: 'u', field: 'created', column: undefined, op: 'IN', value: [d1, d2] });
  });
});

describe('addNullable', () => {
  it('adds .null getter', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    const nf = addNullable(f);
    expect(nf.null).toEqual({ alias: 'u', field: 'age', column: undefined, op: 'IS NULL', value: null });
  });
  it('adds .notNull getter', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    const nf = addNullable(f);
    expect(nf.notNull).toEqual({ alias: 'u', field: 'age', column: undefined, op: 'IS NOT NULL', value: null });
  });
  it('returns object with null and notNull properties', () => {
    const f = new NumberFilter(sqb(), 'age', 'u');
    const nf = addNullable(f);
    expect('null' in nf).toBe(true);
    expect('notNull' in nf).toBe(true);
  });
});
