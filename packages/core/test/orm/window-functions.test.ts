import { describe, it, expect } from 'vitest';
import { windowFunctions } from '../../src/orm/field-builders/window-functions';
import { WindowField } from '../../src/orm/ast/window-field';
import { WindowSpec } from '../../src/orm/ast/window-spec';
import { AggregateField } from '../../src/orm/ast/aggregate';
import { SelectableField } from '../../src/orm/ast/selectable';
import type { OrderDirection } from '../../src/orm/types/proxy';

function field(name: string): SelectableField<string> {
  return new SelectableField<string, string>('u', name);
}

const orders: { asc: readonly OrderDirection[] } = {
  asc: [{ tableAlias: 'u', fieldName: 'x', direction: 'asc' }],
};

describe('window functions', () => {
  it('rank-family creates WindowField<number> with no args', () => {
    for (const [name, fn] of [
      ['row_number', windowFunctions.rowNumber],
      ['rank', windowFunctions.rank],
      ['dense_rank', windowFunctions.denseRank],
      ['percent_rank', windowFunctions.percentRank],
      ['cume_dist', windowFunctions.cumeDist],
    ] satisfies Array<[string, () => WindowField<number>]>) {
      const w = fn();
      expect(w).toBeInstanceOf(WindowField);
      expect(w.kind).toBe('window');
      expect(w.func).toBe(name);
      expect(w.args).toEqual([]);
      expect(w.aggregate).toBe(false);
    }
  });

  it('ntile keeps its bucket argument', () => {
    const w = windowFunctions.ntile(4);
    expect(w.func).toBe('ntile');
    expect(w.args).toEqual([4]);
  });

  it('lag/lead keep offset and default in order', () => {
    const f = field('amount');
    const w = windowFunctions.lag(f, 2, 0);
    expect(w.func).toBe('lag');
    expect(w.args).toEqual([2, 0]);
    expect(windowFunctions.lead(f, 1).args).toEqual([1]);
    expect(windowFunctions.lag(f).args).toEqual([]);
  });

  it('nth_value keeps n', () => {
    const w = windowFunctions.nthValue(field('amount'), 3);
    expect(w.func).toBe('nth_value');
    expect(w.args).toEqual([3]);
  });

  it('first/last_value are non-null, lag/lead/nth_value stay nullable', () => {
    const f = field('amount');
    const first: WindowField<string> = windowFunctions.firstValue(f);
    const last: WindowField<string> = windowFunctions.lastValue(f);
    const lag: WindowField<string | null> = windowFunctions.lag(f);
    const nth: WindowField<string | null> = windowFunctions.nthValue(f, 2);
    expect([first.func, last.func, lag.func, nth.func]).toEqual([
      'first_value',
      'last_value',
      'lag',
      'nth_value',
    ]);
  });

  it('partitionBy/orderBy/rowsBetween build the spec immutably', () => {
    const w = windowFunctions.rank().partitionBy(field('dept'));
    const before = w.over;
    w.orderBy(...orders.asc);
    const after = w.over;
    expect(before).not.toBe(after);
    expect(after.partitionBy).toHaveLength(1);
    expect(after.orderBy).toHaveLength(1);
    const withFrame = w.rowsBetween('unbounded', 'current');
    expect(withFrame.over.frame).toEqual(['unbounded', 'current']);
  });

  it('rowsBetween rejects zero and fractional offsets', () => {
    const w = windowFunctions.rowNumber();
    expect(() => w.rowsBetween(0, 'current')).toThrow(/non-zero/);
    expect(() => w.rowsBetween(1.5, 'current')).toThrow(/non-zero/);
    expect(w.rowsBetween(1, 2).over.frame).toEqual([1, 2]);
  });

  it('validate() requires ORDER BY for rank-family, allows row_number', () => {
    expect(() => windowFunctions.rank().validate()).toThrow(/ORDER BY/);
    expect(() => windowFunctions.denseRank().validate()).toThrow(/ORDER BY/);
    expect(() => windowFunctions.rowNumber().validate()).not.toThrow();
    expect(() =>
      windowFunctions
        .rank()
        .orderBy(...orders.asc)
        .validate(),
    ).not.toThrow();
  });

  it('aggregate.over() creates a windowed aggregate', () => {
    const agg = new AggregateField<number>('sum', field('amount'));
    const w = agg.over();
    expect(w).toBeInstanceOf(WindowField);
    expect(w.func).toBe('sum');
    expect(w.aggregate).toBe(true);
    expect(w.field).toBe(agg.field);
  });

  it('.as() returns a new instance leaving the original unchanged', () => {
    const w = windowFunctions.rowNumber().orderBy(...orders.asc);
    const copy = w.as('rn');
    expect(copy).not.toBe(w);
    expect(copy.alias).toBe('rn');
    expect(w.alias).toBe('');
    expect(copy.over.orderBy).toHaveLength(1);
  });

  it('WindowSpec is immutable data', () => {
    const spec = new WindowSpec();
    expect(spec.partitionBy).toEqual([]);
    expect(spec.orderBy).toEqual([]);
    expect(spec.frame).toBeNull();
  });
});
