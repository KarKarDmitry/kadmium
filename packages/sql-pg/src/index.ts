/**
 * @karkardmitry/kadmium-sql-pg
 * PostgreSQL adapter for Kadmium.
 *
 * Базируется на старом kadmium-core, но использует:
 * - SqlAdapter / ReadonlySqb из @karkardmitry/kadmium-sql-types
 * - pg (node-postgres) для подключения
 */

import { Pool, PoolClient, types as pgTypes } from 'pg';
import type {
  SqlAdapter,
  TransactionalAdapter,
  ReadonlySqb,
  IncludedRelation,
} from '@karkardmitry/kadmium-sql-types';
import { SqlGenerator } from './sql-generator';
import { ResultReshaper } from './result-reshaper';
import { PgDdlAdapter } from './ddl-adapter';

type QueryFn = (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

function buildInsertSql(
  collectionName: string,
  data: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const keys = Object.keys(data);
  const columns = keys.map((k) => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((key) => data[key]);
  const text =
    `INSERT INTO "${collectionName}" (${columns}) VALUES (${placeholders}) RETURNING *`
      .trim()
      .replace(/\s+/g, ' ');
  return { text, values };
}

async function createRow(
  queryFn: QueryFn,
  collectionName: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { text, values } = buildInsertSql(collectionName, data);
  const result = await queryFn(text, values);
  return result.rows[0] as Record<string, unknown>;
}

function buildInsertManySql(
  collectionName: string,
  rows: Record<string, unknown>[],
): { text: string; values: unknown[] } {
  if (rows.length === 0) throw new Error('createMany requires at least one row');
  const keys = Object.keys(rows[0]);
  const columns = keys.map((k) => `"${k}"`).join(', ');
  const values: unknown[] = [];
  const valuePlaceholders = rows.map((row) => {
    const placeholders = keys.map((_, i) => `$${values.length + i + 1}`);
    values.push(...keys.map((k) => row[k]));
    return `(${placeholders.join(', ')})`;
  });
  const text =
    `INSERT INTO "${collectionName}" (${columns}) VALUES ${valuePlaceholders.join(', ')} RETURNING *`
      .trim()
      .replace(/\s+/g, ' ');
  return { text, values };
}

async function createManyRows(
  queryFn: QueryFn,
  collectionName: string,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const { text, values } = buildInsertManySql(collectionName, rows);
  const result = await queryFn(text, values);
  return result.rows as Record<string, unknown>[];
}

async function rawQuery<T = unknown>(
  queryFn: QueryFn,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await queryFn(sql, params);
  return result.rows as T[];
}

// int8 (bigint) → number, чтобы runtime совпадал с типом `number`.
// ⚠️ Ограничение: значения > 2^53 теряют точность. Для больших внешних id
// используйте PK типа uuid/string (f.pk.string / f.pk.uuid).
pgTypes.setTypeParser(20, (val: string | null) =>
  val === null ? null : Number(val),
);

/**
 * Срезает префикс `prop.` с ключей JSON-объектов include-подзапросов,
 * превращая `{"author.id":1,"author.name":"..."}` в `{id:1,name:"..."}`.
 * Рекурсивно обрабатывает вложенные include (по дереву includes).
 */
function unpackIncludeValue(value: unknown, inc: IncludedRelation): unknown {
  if (Array.isArray(value)) return value.map((v) => unpackIncludeValue(v, inc));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const prefix = `${inc.propertyName}.`;
    const nested = inc.internalSqb.includes;
    // O(1) lookup вместо O(k) find на каждый ключ
    const nestedMap = new Map(nested.map((n) => [n.propertyName, n]));
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const clean = k.startsWith(prefix) ? k.slice(prefix.length) : k;
      const nestedInc = nestedMap.get(clean);
      out[clean] = nestedInc ? unpackIncludeValue(v, nestedInc) : v;
    }
    return out;
  }
  return value;
}

function unpackIncludes(
  rows: Record<string, unknown>[],
  includes: readonly IncludedRelation[],
): Record<string, unknown>[] {
  for (const row of rows) {
    for (const inc of includes) {
      if (row[inc.propertyName] !== undefined) {
        row[inc.propertyName] = unpackIncludeValue(row[inc.propertyName], inc);
      }
    }
  }
  return rows;
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

  constructor(client: PoolClient, logger?: (sql: string, params: unknown[]) => void) {
    super();
    this.client = client;
    this.ddl = new PgDdlAdapter(client);
    this.logger = logger;
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
    this.logger?.(text, values);
    const result = await this.client.query(text, values);
    if (sqb.operation !== 'select' || sqb.tableContext.size <= 1)
      return unpackIncludes(result.rows, sqb.includes);
    return ResultReshaper.reshape(
      unpackIncludes(result.rows, sqb.includes),
      sqb.selects || [],
      [...sqb.includes],
    );
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
  ): Promise<Record<string, unknown>[]> {
    return createManyRows((t, v) => this.client.query(t, v), collectionName, rows);
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
    this.logger?.(text, values);
    const result = await this.pool.query(text, values);
    if (sqb.operation !== 'select' || sqb.tableContext.size <= 1)
      return unpackIncludes(result.rows, sqb.includes);
    return ResultReshaper.reshape(
      unpackIncludes(result.rows, sqb.includes),
      sqb.selects || [],
      [...sqb.includes],
    );
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
  ): Promise<Record<string, unknown>[]> {
    return createManyRows((t, v) => this.pool.query(t, v), collectionName, rows);
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
 *   const adapter = createDebugAdapter();
 *   orm.single(User, adapter).where(u => u.name.eq('Alice')).toSql();
 */
export function createDebugAdapter(): SqlAdapter {
  const gen = new DebugSqlGenerator();
  return {
    toSql: (sqb) => gen.toSql(sqb),
    execute: () => { throw new Error(NOT_ALLOWED); },
    create: () => { throw new Error(NOT_ALLOWED); },
    createMany: () => { throw new Error(NOT_ALLOWED); },
    raw: () => { throw new Error(NOT_ALLOWED); },
    ddl: new Proxy({} as PgDdlAdapter, {
      get: () => { throw new Error(NOT_ALLOWED); },
    }),
    beginTransaction: () => { throw new Error(NOT_ALLOWED); },
  };
}

export {
  computeDiff,
  applyDiff,
  renderSql,
  checkHealth,
  pgType,
  normalizePgType,
  diffToHealth,
  renderDefault,
} from './diff';
export type { DiffOp, DiffResult, HealthCheckResult } from './diff';
export { PgDdlAdapter } from './ddl-adapter';
