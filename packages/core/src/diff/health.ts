/**
 * checkHealth — то же сравнение, что и миграция, но без плана изменений.
 *
 * Отдельная функция, а не флаг у `computeDiff()`: пользователю нужен ответ
 * «сходится ли схема», а не «что именно предлагается менять».
 */

import type {
  DbDdlAdapter,
  Dialect,
  DiffResult,
  HealthCheckResult,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';
import { computeDiff } from './compute';

export async function checkHealth(
  irs: readonly IrModel[],
  ddl: DbDdlAdapter,
  dialect: Dialect,
): Promise<HealthCheckResult> {
  const diff = await computeDiff(irs, ddl, dialect);
  return diffToHealth(irs, diff);
}

/**
 * Имена и коллекции — всё, что читает отчёт: полей моделей он не смотрит.
 */
export function diffToHealth(
  irs: readonly Pick<IrModel, 'name' | 'collection'>[],
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
  if (diff.summary.alteredForeignKeys > 0) {
    issues.push(
      `${diff.summary.alteredForeignKeys} foreign key(s) with a different referential action`,
    );
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
