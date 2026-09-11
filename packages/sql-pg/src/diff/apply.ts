/**
 * applyDiff — apply structured diff operations to DB.
 */

import type { DbDdlAdapter, SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { DiffOp, DiffResult, AddIndexOp } from './types';

/** Render a single DiffOp as a human-readable description */
function opToString(op: DiffOp): string {
  switch (op.type) {
    case 'create-table':
      return `CREATE TABLE ${op.table}`;
    case 'drop-table':
      return `DROP TABLE ${op.table}`;
    case 'add-column':
      return `ADD COLUMN ${op.table}.${op.column.name}`;
    case 'drop-column':
      return `DROP COLUMN ${op.table}.${op.columnName}`;
    case 'alter-type':
      return `ALTER TYPE ${op.table}.${op.columnName}: ${op.oldType} → ${op.newType}`;
    case 'alter-nullable':
      return `ALTER NULLABLE ${op.table}.${op.columnName}: ${op.oldNullable} → ${op.newNullable}`;
    case 'add-index':
      return `ADD INDEX ${op.index.name} on ${op.index.tableName}`;
    case 'drop-index':
      return `DROP INDEX ${op.indexName}`;
    case 'add-foreign-key':
      return `ADD FK ${op.fk.name} (${op.fk.tableName} → ${op.fk.refTable})`;
    case 'drop-foreign-key':
      return `DROP FK ${op.fkName} on ${op.tableName}`;
  }
}

export async function applyDiff(
  diff: DiffResult,
  ddl: DbDdlAdapter,
): Promise<string[]> {
  return applyDiffOps(diff, ddl);
}

/**
 * Two-phase apply: Phase 1 creates every table, Phase 2 applies indexes, FKs
 * and column changes. Running all operations inside a single transaction
 * keeps the schema consistent even when a later operation fails.
 */
export async function applyDiffTransactional(
  diff: DiffResult,
  adapter: SqlAdapter,
): Promise<string[]> {
  const tx = await adapter.beginTransaction();
  try {
    const applied = await applyDiffOps(diff, tx.ddl);
    await tx.commit();
    return applied;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // rollback failure must not mask the original error
    }
    throw err;
  }
}

async function applyDiffOps(
  diff: DiffResult,
  ddl: DbDdlAdapter,
): Promise<string[]> {
  const applied: string[] = [];

  // Phase 1: CREATE TABLE (without inline UNIQUE for index fields)
  // Indexes and FKs are handled in phase 2
  const tableOps = diff.operations.filter((o) => o.type === 'create-table');
  for (const op of tableOps) {
    // Strip inline UNIQUE from columns that will get separate index ops
    // (otherwise PG auto-creates indexes with _key suffix that we can't track)
    const idxFieldNames = new Set(
      diff.operations
        .filter(
          (o): o is AddIndexOp =>
            o.type === 'add-index' && o.index.tableName === op.table,
        )
        .flatMap((o) => o.index.columns),
    );
    const cols = op.columns.map((c) => ({
      ...c,
      isUnique: idxFieldNames.has(c.name) ? false : c.isUnique,
    }));
    await ddl.createTable(op.table, cols);
    applied.push(opToString(op));
  }

  // Phase 2: Everything else (indexes, FKs, alters)
  const restOps = diff.operations.filter((o) => o.type !== 'create-table');
  for (const op of restOps) {
    await executeOp(op, ddl);
    applied.push(opToString(op));
  }

  return applied;
}

async function executeOp(op: DiffOp, ddl: DbDdlAdapter): Promise<void> {
  switch (op.type) {
    case 'create-table':
      // handled above
      break;
    case 'drop-table':
      console.warn(`[kadmium] Skipping drop-table: ${op.table}`);
      break;
    case 'add-column':
      await ddl.addColumn(op.table, op.column);
      break;
    case 'drop-column':
      await ddl.dropColumn(op.table, op.columnName);
      break;
    case 'alter-type':
      await ddl.alterType(op.table, op.columnName, op.newType);
      break;
    case 'alter-nullable':
      await ddl.alterNullable(op.table, op.columnName, op.newNullable);
      break;
    case 'add-index':
      await ddl.addIndex(op.index);
      break;
    case 'drop-index':
      await ddl.dropIndex(op.indexName);
      break;
    case 'add-foreign-key':
      await ddl.addForeignKey(op.fk);
      break;
    case 'drop-foreign-key':
      await ddl.dropForeignKey(op.fkName, op.tableName);
      break;
  }
}
