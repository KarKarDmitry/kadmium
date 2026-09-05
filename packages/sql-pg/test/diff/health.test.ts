import { describe, it, expect } from 'vitest';
import { diffToHealth } from '../../src/diff/index';
import type { DiffResult } from '../../src/diff/types';

function makeDiff(overrides: Partial<DiffResult['summary']> = {}): DiffResult {
  return {
    operations: [],
    hasChanges: false,
    summary: {
      addedTables: 0,
      droppedTables: 0,
      addedColumns: 0,
      droppedColumns: 0,
      alteredColumns: 0,
      addedIndexes: 0,
      droppedIndexes: 0,
      addedForeignKeys: 0,
      droppedForeignKeys: 0,
      ...overrides,
    },
  };
}

describe('diffToHealth', () => {
  const irs = [
    { name: 'User', collection: 'users' },
    { name: 'Post', collection: 'posts' },
  ];

  it('healthy when no issues', () => {
    const result = diffToHealth(irs, makeDiff());
    expect(result.isHealthy).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.summary).toEqual({ tablesMissing: 0, tablesExpected: 2, tablesMatching: 2 });
  });

  it('reports missing tables', () => {
    const result = diffToHealth(irs, makeDiff({ addedTables: 1 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues).toContain('1 table(s) missing from database');
    expect(result.summary.tablesMissing).toBe(1);
    expect(result.summary.tablesMatching).toBe(1);
  });

  it('reports missing columns', () => {
    const result = diffToHealth(irs, makeDiff({ addedColumns: 3 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues).toContain('3 column(s) missing');
  });

  it('reports extra columns', () => {
    const result = diffToHealth(irs, makeDiff({ droppedColumns: 2 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues).toContain('2 extra column(s) in database');
  });

  it('reports altered columns', () => {
    const result = diffToHealth(irs, makeDiff({ alteredColumns: 1 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues).toContain('1 column(s) have type/nullability changes');
  });

  it('reports missing indexes', () => {
    const result = diffToHealth(irs, makeDiff({ addedIndexes: 2 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues).toContain('2 index(es) missing');
  });

  it('reports missing foreign keys', () => {
    const result = diffToHealth(irs, makeDiff({ addedForeignKeys: 1 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues).toContain('1 foreign key(s) missing');
  });

  it('multiple issues combined', () => {
    const result = diffToHealth(irs, makeDiff({ addedTables: 1, addedColumns: 2, alteredColumns: 1 }));
    expect(result.isHealthy).toBe(false);
    expect(result.issues.length).toBe(3);
  });
});
