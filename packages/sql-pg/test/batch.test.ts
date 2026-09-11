import { describe, it, expect } from 'vitest';
import { maxBatchRows } from '../src/batch';

describe('maxBatchRows', () => {
  it('uses the full parameter budget for a single column', () => {
    expect(maxBatchRows(1)).toBe(65535);
  });

  it('scales with column count', () => {
    expect(maxBatchRows(3)).toBe(21845);
    expect(maxBatchRows(65)).toBe(1008);
    expect(maxBatchRows(100)).toBe(655);
    expect(maxBatchRows(65535)).toBe(1);
  });

  it('never returns less than one row', () => {
    expect(maxBatchRows(70000)).toBe(1);
  });

  it('guards invalid column counts', () => {
    expect(maxBatchRows(0)).toBe(1);
    expect(maxBatchRows(-5)).toBe(1);
    expect(maxBatchRows(1.5)).toBe(1);
    expect(maxBatchRows(NaN)).toBe(1);
  });
});