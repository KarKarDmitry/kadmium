import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { KadmiumApp, Model, type ModelIR } from '@karkardmitry/kadmium-core';
import type { AppCore } from '@karkardmitry/kadmium-core';
import type { OrmManager } from '@karkardmitry/kadmium-core';
import type { PgAdapter } from '@karkardmitry/kadmium-sql-pg';
import { User, Post, Comment } from '../src/models';

export const MODELS: Array<typeof Model> = [User, Post, Comment];

/** Загрузить .env в process.env (не перезатирая уже заданные). */
export function loadEnv(): void {
  const p = resolve(process.cwd(), '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export interface Harness {
  adapter: PgAdapter;
  app: AppCore;
  orm: OrmManager;
  irs: Map<string, ModelIR>;
}

/**
 * Инициализировать ядро через KadmiumApp + await app.init().
 * Модели регистрируются самим init() из kadmium.config.ts, SQL-адаптер —
 * из config.modules. Возвращает адаптер/ядро/ORM для тестов.
 */
export async function makeHarness(): Promise<Harness> {
  loadEnv();
  const kadmium = new KadmiumApp();
  await kadmium.init();
  const app = kadmium.appCore;
  const adapter = app.sqlAdapter as PgAdapter;
  const orm = kadmium.orm;
  const irs = new Map<string, ModelIR>();
  for (const ir of app.allIrs) irs.set(ir.name, ir);
  return { adapter, app, orm, irs };
}

/** Полностью очистить БД (drop всех таблиц). */
export async function dropAllTables(adapter: PgAdapter): Promise<void> {
  for (const t of await adapter.ddl.inspectTables()) {
    await adapter.ddl.dropTable(t.name);
  }
}

/** Создать схему из моделей через computeDiff + applyDiff. */
export async function syncSchema(h: Harness): Promise<void> {
  const { computeDiff, applyDiff } =
    await import('@karkardmitry/kadmium-sql-pg');
  const diff = await computeDiff(h.app.allIrs, h.adapter.ddl);
  await applyDiff(diff, h.adapter.ddl);
}
