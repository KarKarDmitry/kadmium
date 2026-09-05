import { describe, it, expect } from 'vitest';
import { aggregates } from '../../src/orm/field-builders/aggregates';
import { AggregateField } from '../../src/orm/ast/aggregate';
import { SelectableField } from '../../src/orm/ast/selectable';

function field(name: string): SelectableField {
  return new SelectableField('u', name);
}

describe('aggregates', () => {
  it('count("*") creates COUNT(*)', () => {
    const a = aggregates.count('*');
    expect(a).toBeInstanceOf(AggregateField);
    expect(a.func).toBe('count');
    expect(a.field).toBe('*');
  });

  it('count(field) creates COUNT with field', () => {
    const f = field('name');
    const a = aggregates.count(f);
    expect(a.func).toBe('count');
    expect(a.field).toBe(f);
  });

  it('sum creates SUM', () => {
    const a = aggregates.sum(field('amount'));
    expect(a.func).toBe('sum');
  });

  it('avg creates AVG', () => {
    const a = aggregates.avg(field('amount'));
    expect(a.func).toBe('avg');
  });

  it('min creates MIN', () => {
    const a = aggregates.min(field('age'));
    expect(a.func).toBe('min');
  });

  it('max creates MAX', () => {
    const a = aggregates.max(field('age'));
    expect(a.func).toBe('max');
  });

  it('.as() sets alias and returns self', () => {
    const a = aggregates.count('*');
    const result = a.as('total');
    expect(result).toBe(a);
    expect(a.alias).toBe('total');
  });
});

describe('AggregateField.toSql', () => {
  it('COUNT(*) AS "total"', () => {
    const a = aggregates.count('*').as('total');
    expect(a.toSql()).toBe('COUNT(*) AS "total"');
  });

  it('SUM("u"."amount") AS "sum"', () => {
    const a = aggregates.sum(field('amount')).as('sum');
    expect(a.toSql()).toBe('SUM("u"."amount") AS "sum"');
  });

  it('AVG("u"."age") AS "avg"', () => {
    const a = aggregates.avg(field('age')).as('avg');
    expect(a.toSql()).toBe('AVG("u"."age") AS "avg"');
  });

  it('MIN("u"."age") AS "min"', () => {
    const a = aggregates.min(field('age')).as('min');
    expect(a.toSql()).toBe('MIN("u"."age") AS "min"');
  });

  it('MAX("u"."age") AS "max"', () => {
    const a = aggregates.max(field('age')).as('max');
    expect(a.toSql()).toBe('MAX("u"."age") AS "max"');
  });

  it('throws without alias', () => {
    const a = aggregates.count('*');
    expect(() => a.toSql()).toThrow('Aggregate must have an alias');
  });
});
