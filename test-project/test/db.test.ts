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
    const { computeDiff, renderSql } = await import('@karkardmitry/kadmium-sql-pg');
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    expect(renderSql(diff)).toContain('No changes needed');
  });

  it('detects a missing table as unhealthy', async () => {
    const { computeDiff, diffToHealth } = await import('@karkardmitry/kadmium-sql-pg');
    // Эмулируем diff с отсутствующей таблицей
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    const altered = { ...diff, summary: { ...diff.summary, addedTables: 1 } };
    const health = diffToHealth(h.app.allIrs, altered);
    expect(health.isHealthy).toBe(false);
    expect(health.summary.tablesMissing).toBe(1);
  });

  it('extra tables in DB are not auto-dropped by applyDiff', async () => {
    await h.adapter.ddl.raw('CREATE TABLE IF NOT EXISTS "unmanaged_extra" (id bigint)');
    const { computeDiff } = await import('@karkardmitry/kadmium-sql-pg');
    const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
    // droppedTables не заполняется при создании (не авто-дроп)
    const hasDrop = diff.operations.some(
      (o: any) => o.type === 'drop-table' && o.table === 'unmanaged_extra',
    );
    expect(hasDrop).toBe(false);
    await h.adapter.ddl.raw('DROP TABLE IF EXISTS "unmanaged_extra"');
  });

  it('field .default() reaches DDL as a column default', async () => {
    const cols = await h.adapter.ddl.inspectColumns('post');
    const views = cols.find((c) => c.name === 'views')!;
    expect(views).toBeDefined();
    expect(views.defaultValue).toContain('0');
  });
});
