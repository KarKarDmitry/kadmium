/**
 * Schema diff — barrel export + health check.
 *
 * Ported from kadmium-core's db-mutator, adapted for our IR types.
 */

import type { DbDdlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { DiffResult, IrField, HealthCheckResult } from './types';
import { computeDiff } from './compute';

export type {
  DiffOp,
  DiffResult,
  HealthCheckResult,
  IrField,
  AddColumnOp,
  DropColumnOp,
  AlterTypeOp,
  AlterNullableOp,
  AddIndexOp,
  DropIndexOp,
  AddForeignKeyOp,
  DropForeignKeyOp,
  CreateTableOp,
  DropTableOp,
} from './types';

export {
  pgType,
  normalizePgType,
  isPrimaryField,
  renderDefault,
  irToColumns,
  expectedIndexes,
  expectedForeignKeys,
} from './types';

export { computeDiff } from './compute';
export { applyDiff } from './apply';
export { renderSql } from './render';

/* ════════════════════════════════════════
   Health Check
   ════════════════════════════════════════ */

export async function checkHealth(
  irs: Array<{
    name: string;
    collection: string;
    fields: Record<string, IrField>;
  }>,
  ddl: DbDdlAdapter,
): Promise<HealthCheckResult> {
  const diff = await computeDiff(irs, ddl);
  return diffToHealth(irs, diff);
}

export function diffToHealth(
  irs: Array<{ name: string; collection: string }>,
  diff: DiffResult,
): HealthCheckResult {
  const issues: string[] = [];

  if (diff.summary.addedTables > 0) {
    issues.push(`${diff.summary.addedTables} table(s) missing from database`);
  }
  if (diff.summary.addedColumns > 0) {
    issues.push(`${diff.summary.addedColumns} column(s) missing`);
  }
  if (diff.summary.droppedColumns > 0) {
    issues.push(`${diff.summary.droppedColumns} extra column(s) in database`);
  }
  if (diff.summary.alteredColumns > 0) {
    issues.push(
      `${diff.summary.alteredColumns} column(s) have type/nullability changes`,
    );
  }
  if (diff.summary.addedIndexes > 0) {
    issues.push(`${diff.summary.addedIndexes} index(es) missing`);
  }
  if (diff.summary.addedForeignKeys > 0) {
    issues.push(`${diff.summary.addedForeignKeys} foreign key(s) missing`);
  }

  return {
    isHealthy: issues.length === 0,
    issues,
    summary: {
      tablesMissing: diff.summary.addedTables,
      tablesExpected: irs.length,
      tablesMatching: irs.length - diff.summary.addedTables,
    },
  };
}
