/**
 * @karkardmitry/kadmium-sql-pg
 * PostgreSQL adapter for Kadmium.
 *
 * Базируется на старом kadmium-core, но использует:
 * - SqlAdapter / ReadonlySqb из @karkardmitry/kadmium-sql-types
 * - pg (node-postgres) для подключения
 */

import { Pool, PoolClient, types as pgTypes } from 'pg';
import type { TypeId, TypeFormat } from 'pg-types';
import type {
  SqlAdapter,
  TransactionalAdapter,
  ReadonlySqb,
} from '@karkardmitry/kadmium-sql-types';
import { SqlGenerator, assertNoUnfilledSlots } from './sql-generator';
import { PgDdlAdapter } from './ddl-adapter';
import { maxBatchRows } from './batch';
import {
  unionKeys,
  createRow,
  buildInsertManySql,
  buildUpsertManySql,
  createManyRows,
  rawQuery,
  finalizeRows,
} from './helpers';

// Per-pool int8 (bigint) → number parser.
// Avoids global pgTypes.setTypeParser which conflicts with other pg users.
// ⚠️ Limitation: values > 2^53 lose precision. Use uuid/string PK for large ids.
function createKadmiumTypes() {
  const int8Parser = (val: string | null) =>
    val === null ? null : Number(val);

  return {
    getTypeParser(oid: TypeId, format?: TypeFormat) {
      if (oid === 20) return int8Parser;
      return pgTypes.getTypeParser(oid, format);
    },
    setTypeParser: pgTypes.setTypeParser,
  };
}

export interface PgAdapterConfig {
  host?: string;
  port?: number;
  database?: string;
  login?: string;
  password?: string;
  poolSize?: number;
  /** Called before each query with the SQL text and bound parameters. */
  logger?: (sql: string, params: unknown[]) => void;
}

// ═══ Transactional Adapter ═══

class TransactionalPgAdapter
  extends SqlGenerator
  implements TransactionalAdapter
{
  private client: PoolClient;
  private _released = false;
  public ddl: PgDdlAdapter;
  private logger?: (sql: string, params: unknown[]) => void;

  constructor(
    client: PoolClient,
    logger?: (sql: string, params: unknown[]) => void,
  ) {
    super();
    this.client = client;
    this.ddl = new PgDdlAdapter(client);
    this.logger = logger;
  }

  beginTransaction(): Promise<TransactionalAdapter> {
    throw new Error('Nested transactions are not supported');
  }

  async commit(): Promise<void> {
    await this.client.query('COMMIT');
  }

  async rollback(): Promise<void> {
    try {
      await this.client.query('ROLLBACK');
    } catch {
      // ROLLBACK may fail if connection is broken; swallow to preserve original error
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
    assertNoUnfilledSlots(values);
    this.logger?.(text, values);
    const result = await this.client.query(text, values);
    return finalizeRows(result.rows, sqb);
  }

  /** Превратить плоские строки в результат под контекст запроса (B2, orm.run). */
  reshape(
    sqb: ReadonlySqb,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return finalizeRows(rows, sqb);
  }

  async create(
    collectionName: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return createRow((t, v) => this.client.query(t, v), collectionName, data);
  }

  async createMany(
    collectionName: string,
    rows: Record<string, unknown>[],
    options?: {
      transaction?: boolean;
      conflictTarget?: string[];
      doNothing?: boolean;
    },
  ): Promise<Record<string, unknown>[]> {
    // Already in a transaction — ignore options.transaction
    const conflictTarget = options?.conflictTarget ?? [];
    const builder = conflictTarget.length
      ? (name: string, batch: Record<string, unknown>[]) =>
          buildUpsertManySql(name, batch, conflictTarget, !!options?.doNothing)
      : buildInsertManySql;
    return createManyRows(
      (t, v) => this.client.query(t, v),
      collectionName,
      rows,
      builder,
    );
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return rawQuery<T>((t, v) => this.client.query(t, v), sql, params);
  }
}

// ═══ Main Adapter ═══

export class PgAdapter extends SqlGenerator implements SqlAdapter {
  private pool: Pool;
  public ddl: PgDdlAdapter;
  private logger?: (sql: string, params: unknown[]) => void;

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
      types: createKadmiumTypes(),
    });
    this.ddl = new PgDdlAdapter(this.pool);
    this.logger = config.logger;
  }

  async beginTransaction(): Promise<TransactionalAdapter> {
    const client = await this.pool.connect();
    await client.query('BEGIN');
    return new TransactionalPgAdapter(client, this.logger);
  }

  async execute(sqb: ReadonlySqb): Promise<Record<string, unknown>[]> {
    const { text, values } = this.toSql(sqb);
    assertNoUnfilledSlots(values);
    this.logger?.(text, values);
    const result = await this.pool.query(text, values);
    return finalizeRows(result.rows, sqb);
  }

  /** Превратить плоские строки в результат под контекст запроса (B2, orm.run). */
  reshape(
    sqb: ReadonlySqb,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return finalizeRows(rows, sqb);
  }

  async create(
    collectionName: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return createRow((t, v) => this.pool.query(t, v), collectionName, data);
  }

  async createMany(
    collectionName: string,
    rows: Record<string, unknown>[],
    options?: {
      transaction?: boolean;
      conflictTarget?: string[];
      doNothing?: boolean;
    },
  ): Promise<Record<string, unknown>[]> {
    if (rows.length === 0) return [];
    const batchSize = maxBatchRows(unionKeys(rows).length);
    const needsTransaction =
      options?.transaction !== false && rows.length > batchSize;
    const conflictTarget = options?.conflictTarget ?? [];
    const builder = conflictTarget.length
      ? (name: string, batch: Record<string, unknown>[]) =>
          buildUpsertManySql(name, batch, conflictTarget, !!options?.doNothing)
      : buildInsertManySql;
    if (!needsTransaction) {
      return createManyRows(
        (t, v) => this.pool.query(t, v),
        collectionName,
        rows,
        builder,
      );
    }
    // Multi-chunk: wrap in transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { text, values } = builder(collectionName, batch);
        this.logger?.(text, values);
        const result = await client.query(text, values);
        results.push(...(result.rows as Record<string, unknown>[]));
      }
      await client.query('COMMIT');
      return results;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ROLLBACK may fail if connection is broken; swallow to preserve original error
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    return rawQuery<T>((t, v) => this.pool.query(t, v), sql, params);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

// ═══ Debug Adapter ═══

const NOT_ALLOWED = 'Debug adapter: use a real adapter for database queries.';

/** Concrete SqlGenerator for debug adapter (no abstract class issues). */
class DebugSqlGenerator extends SqlGenerator {}

/**
 * Debug adapter — renders SQL without a database connection.
 * Useful for previewing generated SQL during development.
 *
 * toSql() works normally. execute()/create()/raw() throw errors.
 *
 * @example
 *   import { createDebugAdapter } from '@karkardmitry/kadmium-sql-pg';
 *   const app = new KadmiumApp();
 *   app.modules.sql.set(createDebugAdapter());
 *   await app.init();
 *   app.orm.single(User).where(u => u.name.eq('Alice')).toSql();
 */
export function createDebugAdapter(): SqlAdapter {
  const gen = new DebugSqlGenerator();
  return {
    toSql: (sqb) => gen.toSql(sqb),
    execute: () => {
      throw new Error(NOT_ALLOWED);
    },
    create: () => {
      throw new Error(NOT_ALLOWED);
    },
    createMany: () => {
      throw new Error(NOT_ALLOWED);
    },
    raw: () => {
      throw new Error(NOT_ALLOWED);
    },
    reshape: (_sqb, rows) => rows,
    ddl: new Proxy({} as PgDdlAdapter, {
      get: () => {
        throw new Error(NOT_ALLOWED);
      },
    }),
    beginTransaction: () => {
      throw new Error(NOT_ALLOWED);
    },
  };
}

export {
  computeDiff,
  applyDiff,
  applyDiffTransactional,
  renderSql,
  checkHealth,
  pgType,
  normalizePgType,
  diffToHealth,
  renderDefault,
} from './diff';
export type { DiffOp, DiffResult, HealthCheckResult } from './diff';
export { PgDdlAdapter } from './ddl-adapter';
export { ResultReshaper } from './result-reshaper';
export { buildInsertManySql, buildUpsertManySql, unionKeys };
