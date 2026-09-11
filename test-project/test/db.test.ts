import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { makeHarness, syncSchema, type Harness } from './helpers';

let h: Harness;

beforeAll(async () => {
  h = await makeHarness();
  // globalSetup уже создал схему; здесь проверяем, что diff считает её актуальной
  await syncSchema(h);
});

afterAll(async () => {
  await h.adapter.end();
});

describe('db: schema diff + health', () => {
  it('computeDiff reports no changes when schema is in sync', async () => {
    const { computeDiff } = await import('@karkardmitry/kadmium-sql-pg');
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    expect(diff.hasChanges).toBe(false);
    expect(diff.summary.addedTables).toBe(0);
    expect(diff.summary.addedColumns).toBe(0);
  });

  it('checkHealth is healthy', async () => {
    const { checkHealth } = await import('@karkardmitry/kadmium-sql-pg');
    const health = await checkHealth(h.app.allIrs, h.adapter.ddl);
    expect(health.isHealthy).toBe(true);
    expect(health.summary.tablesExpected).toBe(3);
    expect(health.summary.tablesMatching).toBe(3);
  });

  it('renderSql returns no-op when clean', async () => {
    const { computeDiff, renderSql } =
      await import('@karkardmitry/kadmium-sql-pg');
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    expect(renderSql(diff)).toContain('No changes needed');
  });

  it('detects a missing table as unhealthy', async () => {
    const { computeDiff, diffToHealth } =
      await import('@karkardmitry/kadmium-sql-pg');
    // Эмулируем diff с отсутствующей таблицей
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    const altered = { ...diff, summary: { ...diff.summary, addedTables: 1 } };
    const health = diffToHealth(h.app.allIrs, altered);
    expect(health.isHealthy).toBe(false);
    expect(health.summary.tablesMissing).toBe(1);
  });

  it('extra tables in DB are not auto-dropped by applyDiff', async () => {
    await h.adapter.ddl.raw(
      'CREATE TABLE IF NOT EXISTS "unmanaged_extra" (id bigint)',
    );
    const { computeDiff } = await import('@karkardmitry/kadmium-sql-pg');
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    // droppedTables не заполняется при создании (не авто-дроп)
    const hasDrop = diff.operations.some(
      (o: any) => o.type === 'drop-table' && o.table === 'unmanaged_extra',
    );
    expect(hasDrop).toBe(false);
    await h.adapter.ddl.raw('DROP TABLE IF EXISTS "unmanaged_extra"');
  });
});

describe('db: applyDiffTransactional', () => {
  const summary = {
    addedTables: 0,
    droppedTables: 0,
    addedColumns: 0,
    droppedColumns: 0,
    alteredColumns: 0,
    addedIndexes: 0,
    droppedIndexes: 0,
    addedForeignKeys: 0,
    droppedForeignKeys: 0,
  };

  it('applies a multi-phase diff inside a transaction and commits', async () => {
    const { applyDiffTransactional } =
      await import('@karkardmitry/kadmium-sql-pg');

    const diff = {
      hasChanges: true,
      summary,
      operations: [
        {
          type: 'create-table',
          table: 'tx_verify_a',
          columns: [
            {
              name: 'id',
              tableName: 'tx_verify_a',
              dataType: 'integer',
              isNullable: false,
              defaultValue: null,
              isPrimary: true,
              isUnique: true,
              autoIncrement: true,
            },
            {
              name: 'user_id',
              tableName: 'tx_verify_a',
              dataType: 'integer',
              isNullable: false,
              defaultValue: null,
              isPrimary: false,
              isUnique: false,
            },
          ],
        },
        {
          type: 'add-index',
          index: {
            name: 'idx_tx_verify_a_user_id',
            tableName: 'tx_verify_a',
            columns: ['user_id'],
            isUnique: false,
          },
        },
        {
          type: 'add-foreign-key',
          fk: {
            name: 'fk_tx_verify_a_user',
            tableName: 'tx_verify_a',
            columns: ['user_id'],
            refTable: 'user',
            refColumns: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        },
      ],
    } as never;

    try {
      const applied = await applyDiffTransactional(diff, h.adapter);
      expect(applied).toHaveLength(3);

      const tables = await h.adapter.ddl.inspectTables();
      expect(tables.map((t) => t.name)).toContain('tx_verify_a');

      const fks = await h.adapter.ddl.inspectForeignKeys('tx_verify_a');
      expect(fks.some((f) => f.name === 'fk_tx_verify_a_user')).toBe(true);
    } finally {
      await h.adapter.ddl.raw('DROP TABLE IF EXISTS "tx_verify_a" CASCADE');
    }
  });

  it('rolls back the entire diff when an op fails mid-transaction', async () => {
    const { applyDiffTransactional } =
      await import('@karkardmitry/kadmium-sql-pg');

    const diff = {
      hasChanges: true,
      summary,
      operations: [
        {
          type: 'create-table',
          table: 'tx_verify_b',
          columns: [
            {
              name: 'id',
              tableName: 'tx_verify_b',
              dataType: 'integer',
              isNullable: false,
              defaultValue: null,
              isPrimary: true,
              isUnique: true,
              autoIncrement: true,
            },
            {
              name: 'target_id',
              tableName: 'tx_verify_b',
              dataType: 'integer',
              isNullable: false,
              defaultValue: null,
              isPrimary: false,
              isUnique: false,
            },
          ],
        },
        {
          type: 'add-foreign-key',
          fk: {
            name: 'fk_tx_verify_b_target',
            tableName: 'tx_verify_b',
            columns: ['target_id'],
            refTable: 'missing_ref_target',
            refColumns: ['id'],
            onDelete: 'NO ACTION',
            onUpdate: 'NO ACTION',
          },
        },
      ],
    } as never;

    // FK to a nonexistent table fails in phase 2 — phase 1 must be undone.
    await expect(applyDiffTransactional(diff, h.adapter)).rejects.toThrow(
      /missing_ref_target/,
    );

    const tables = await h.adapter.ddl.inspectTables();
    expect(tables.map((t) => t.name)).not.toContain('tx_verify_b');
  });
});
