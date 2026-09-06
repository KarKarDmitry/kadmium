import { describe, it, expect } from 'vitest';
import { SqlGenerator } from '../../src/sql-generator';
import type { WhereCondition } from '@karkardmitry/kadmium-sql-types';

class TestGenerator extends SqlGenerator {}

function where(
  field: string,
  op: string,
  value: unknown,
  alias?: string,
  column?: string,
): WhereCondition {
  return { field, op, value, alias, column };
}

describe('SqlGenerator — _renderValue', () => {
  const gen = new TestGenerator();

  it('parameterizes a primitive value', () => {
    const w = where('name', '=', 'Alice');
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('$1');
    expect(values).toEqual(['Alice']);
  });

  it('renders NULL for null value', () => {
    const w = where('name', '=', null);
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('NULL');
    expect(values).toEqual([]);
  });

  it('renders NULL for undefined value', () => {
    const w = where('name', '=', undefined);
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('NULL');
    expect(values).toEqual([]);
  });

  it('renders IN with array values', () => {
    const w = where('id', 'IN', [1, 2, 3]);
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('IN ($1, $2, $3)');
    expect(values).toEqual([1, 2, 3]);
  });

  it('renders 1=0 for empty IN array', () => {
    const w = where('id', 'IN', []);
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('1=0');
    expect(values).toEqual([]);
  });

  it('renders BETWEEN with 2-element array', () => {
    const w = where('age', 'BETWEEN', [10, 20]);
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('$1 AND $2');
    expect(values).toEqual([10, 20]);
  });

  it('falls through for BETWEEN with wrong-length array', () => {
    const w = where('age', 'BETWEEN', [10]);
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('$1');
    expect(values).toEqual([[10]]);
  });

  it('renders field-to-field comparison via getIdentifierForSql', () => {
    const w = where('id', '=', {
      getIdentifierForSql: () => '"u"."id"',
    });
    const values: unknown[] = [];
    const p = { p: 1 };
    const result = gen['_renderValue'](w, values, p);
    expect(result).toBe('"u"."id"');
    expect(values).toEqual([]);
  });
});
