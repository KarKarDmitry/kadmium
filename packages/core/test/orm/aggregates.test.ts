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

  it('.as() returns new instance with alias, original unchanged', () => {
    const a = aggregates.count('*');
    const result = a.as('total');
    expect(result).not.toBe(a);
    expect(result.alias).toBe('total');
    expect(a.alias).toBe('');
  });
});
