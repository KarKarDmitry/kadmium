/**
 * @karkardmitry/kadmium-sql-pg
 * PostgreSQL adapter for Kadmium.
 *
 * Базируется на старом kadmium-core, но использует:
 * - SqlAdapter / ReadonlySqb из @karkardmitry/kadmium-sql-types
 * - pg (node-postgres) для подключения
 */

import { Pool, PoolClient } from 'pg';
import type {
  SqlAdapter,
  TransactionalAdapter,
  ReadonlySqb,
} from '@karkardmitry/kadmium-sql-types';
import { SqlGenerator } from './sql-generator';
import { ResultReshaper } from './result-reshaper';
import { PgDdlAdapter } from './ddl-adapter';

export interface PgAdapterConfig {
  host?: string;
  port?: number;
  database?: string;
  login?: string;
  password?: string;
  poolSize?: number;
}

// ═══ Transactional Adapter ═══

class TransactionalPgAdapter
  extends SqlGenerator
  implements TransactionalAdapter
{
  private client: PoolClient;
  private _released = false;
  public ddl: PgDdlAdapter;

  constructor(client: PoolClient) {
    super();
    this.client = client;
    this.ddl = new PgDdlAdapter(client);
  }

  beginTransaction(): Promise<TransactionalAdapter> {
    throw new Error('Nested transactions are not supported');
  }

  async commit(): Promise<void> {
    try {
      await this.client.query('COMMIT');
    } finally {
      this._release();
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.client.query('ROLLBACK');
    } finally {
      this._release();
    }
  }

  /** Закрыть соединение (без COMMIT/ROLLBACK). Вызывается из finally transaction() */
  async end(): Promise<void> {
    this._release();
  }

  private _release(): void {
    if (this._released) return;
    this._released = true;
    this.client.release();
  }

  async execute(sqb: ReadonlySqb): Promise<Record<string, unknown>[]> {
    const { text, values } = this.toSql(sqb);
    const result = await this.client.query(text, values);
    if (sqb.operation !== 'select' || sqb.tableContext.size <= 1)
      return result.rows;
    return ResultReshaper.reshape(result.rows, (sqb.selects || []) as any[], [
      ...sqb.includes,
    ]);
  }

  async create(
    collectionName: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const keys = Object.keys(data);
    const columns = keys.map((k) => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map((key) => data[key]);
    const text =
      `INSERT INTO "${collectionName}" (${columns}) VALUES (${placeholders}) RETURNING *`
        .trim()
        .replace(/\s+/g, ' ');
    const result = await this.client.query(text, values);
    return result.rows[0];
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }
}

// ═══ Main Adapter ═══

export class PgAdapter extends SqlGenerator implements SqlAdapter {
  private pool: Pool;
  public ddl: PgDdlAdapter;

  constructor(config: PgAdapterConfig) {
    super();
    if (!config) throw new Error('PgAdapter requires a config');
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.login,
      password: config.password,
      database: config.database,
      max: config.poolSize ?? 10,
    });
    this.ddl = new PgDdlAdapter(this.pool);
  }

  async beginTransaction(): Promise<TransactionalAdapter> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return new TransactionalPgAdapter(client);
  }

  async execute(sqb: ReadonlySqb): Promise<Record<string, unknown>[]> {
    const { text, values } = this.toSql(sqb);
    const result = await this.pool.query(text, values);
    if (sqb.operation !== 'select' || sqb.tableContext.size <= 1)
      return result.rows;
    return ResultReshaper.reshape(result.rows, (sqb.selects || []) as any[], [
      ...sqb.includes,
    ]);
  }

  async create(
    collectionName: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const keys = Object.keys(data);
    const columns = keys.map((k) => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const values = keys.map((key) => data[key]);
    const text =
      `INSERT INTO "${collectionName}" (${columns}) VALUES (${placeholders}) RETURNING *`
        .trim()
        .replace(/\s+/g, ' ');
    const result = await this.pool.query(text, values);
    return result.rows[0];
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export { computeDiff, applyDiff, renderSql, checkHealth, pgType, normalizePgType, diffToHealth } from './diff';
export type { DiffOp, DiffResult, HealthCheckResult } from './diff';
export { PgDdlAdapter } from './ddl-adapter';
