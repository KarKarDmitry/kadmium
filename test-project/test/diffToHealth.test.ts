import { diffToHealth } from '@karkardmitry/kadmium-sql-pg';
import type { DiffResult } from '@karkardmitry/kadmium-sql-pg';

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

const irs = [
  { name: 'users', collection: 'users', fields: {} },
  { name: 'posts', collection: 'posts', fields: {} },
];

describe('diffToHealth', () => {
  it('reports healthy when no changes', () => {
    const result = diffToHealth(irs, makeDiff());
    expect(result.isHealthy).toBe(true);
    expect(result.summary.tablesMissing).toBe(0);
    expect(result.summary.tablesExpected).toBe(2);
    expect(result.summary.tablesMatching).toBe(2);
  });

  it('counts missing tables', () => {
    const result = diffToHealth(irs, makeDiff({ addedTables: 1 }));
    expect(result.summary.tablesMissing).toBe(1);
    expect(result.summary.tablesExpected).toBe(2);
    expect(result.summary.tablesMatching).toBe(1);
    expect(result.isHealthy).toBe(false);
  });

  it('all tables missing → tablesMatching = 0', () => {
    const result = diffToHealth(irs, makeDiff({ addedTables: 2 }));
    expect(result.summary.tablesMatching).toBe(0);
  });

  it('issues mention missing tables', () => {
    const result = diffToHealth(irs, makeDiff({ addedTables: 2 }));
    expect(result.issues.some(i => i.includes('table(s) missing'))).toBe(true);
  });
});
