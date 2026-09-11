import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  DbDdlAdapter,
  DbTable,
  DbColumn,
  DbIndex,
  DbForeignKey,
  SqlAdapter,
} from '@karkardmitry/kadmium-sql-types';
import { KadmiumApp } from '../../src/core/kadmium-app';
import { dbCheck, dbPush, dbSql, dbClear } from '../../src/cli/db';
import { User } from './fixtures/models/user';

/** In-memory DbDdlAdapter: preset state in, recorded calls out. */
class MockDb implements DbDdlAdapter {
  tables: DbTable[] = [];
  columns = new Map<string, DbColumn[]>();
  indexes = new Map<string, DbIndex[]>();
  foreignKeys = new Map<string, DbForeignKey[]>();
  calls: { method: string; args: unknown[] }[] = [];

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async inspectTables(): Promise<DbTable[]> {
    this.record('inspectTables', []);
    return this.tables;
  }

  async inspectAllColumns(names: string[]): Promise<DbColumn[]> {
    this.record('inspectAllColumns', [names]);
    return names.flatMap((t) => this.columns.get(t) ?? []);
  }

  async inspectAllIndexes(names: string[]): Promise<DbIndex[]> {
    this.record('inspectAllIndexes', [names]);
    return names.flatMap((t) => this.indexes.get(t) ?? []);
  }

  async inspectAllForeignKeys(names: string[]): Promise<DbForeignKey[]> {
    this.record('inspectAllForeignKeys', [names]);
    return names.flatMap((t) => this.foreignKeys.get(t) ?? []);
  }

  async createTable(): Promise<void> {
    this.record('createTable', []);
  }

  async addColumn(): Promise<void> {
    this.record('addColumn', []);
  }

  async dropColumn(): Promise<void> {
    this.record('dropColumn', []);
  }

  async alterType(): Promise<void> {
    this.record('alterType', []);
  }

  async alterNullable(): Promise<void> {
    this.record('alterNullable', []);
  }

  async alterDefault(): Promise<void> {
    this.record('alterDefault', []);
  }

  async addIndex(idx: DbIndex): Promise<void> {
    this.record('addIndex', [idx]);
  }

  async dropIndex(): Promise<void> {
    this.record('dropIndex', []);
  }

  async addForeignKey(): Promise<void> {
    this.record('addForeignKey', []);
  }

  async dropForeignKey(): Promise<void> {
    this.record('dropForeignKey', []);
  }

  async dropTable(name: string): Promise<void> {
    this.record('dropTable', [name]);
  }

  async raw(): Promise<Record<string, unknown>[]> {
    this.record('raw', []);
    return [];
  }

  of(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

function makeAdapter(ddl: MockDb): {
  adapter: SqlAdapter;
  commit: ReturnType<typeof vi.fn>;
} {
  const commit = vi.fn().mockResolvedValue(undefined);
  const rollback = vi.fn().mockResolvedValue(undefined);
  const tx = {
    toSql: vi.fn().mockReturnValue({ text: 'BEGIN', values: [] }),
    execute: vi.fn().mockResolvedValue([]),
    raw: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue([]),
    ddl,
    beginTransaction: vi.fn(),
    commit,
    rollback,
    end: vi.fn().mockResolvedValue(undefined),
  };
  const adapter = {
    toSql: vi.fn().mockReturnValue({ text: 'SELECT 1', values: [] }),
    execute: vi.fn().mockResolvedValue([]),
    raw: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue([]),
    ddl,
    beginTransaction: vi.fn().mockResolvedValue(tx),
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as SqlAdapter;
  return { adapter, commit };
}

const healthyUsers: DbColumn[] = [
  {
    name: 'id',
    tableName: 'user',
    dataType: 'bigint',
    isNullable: false,
    defaultValue: null,
    isPrimary: true,
    isUnique: true,
    autoIncrement: true,
  },
  {
    name: 'name',
    tableName: 'user',
    dataType: 'character varying',
    isNullable: true,
    defaultValue: null,
    isPrimary: false,
    isUnique: false,
  },
  {
    name: 'email',
    tableName: 'user',
    dataType: 'character varying',
    isNullable: true,
    defaultValue: null,
    isPrimary: false,
    isUnique: true,
  },
];

function makeApp(ddl: MockDb): KadmiumApp {
  const app = new KadmiumApp();
  const { adapter } = makeAdapter(ddl);
  app.modules.sql.set(adapter);
  app.appCore.register([User]);
  return app;
}

describe('db:* commands', () => {
  const dirs: string[] = [];
  let logs: string[];

  beforeEach(() => {
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
  });

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
    vi.restoreAllMocks();
  });

  it('dbCheck reports out-of-date schema when table is missing', async () => {
    const ddl = new MockDb();
    const app = makeApp(ddl);

    await dbCheck(app);

    expect(logs.some((l) => l.includes('needs migration'))).toBe(true);
    expect(logs.some((l) => l.includes('Tables: 0/1'))).toBe(true);
  });

  it('dbCheck reports healthy schema matching the model', async () => {
    const ddl = new MockDb();
    ddl.tables = [{ name: 'user' }];
    ddl.columns.set('user', healthyUsers);
    ddl.indexes.set('user', [
      {
        name: 'idx_user_email',
        tableName: 'user',
        columns: ['email'],
        isUnique: true,
      },
    ]);
    const app = makeApp(ddl);

    await dbCheck(app);

    expect(logs.some((l) => l.includes('up to date'))).toBe(true);
    expect(logs.some((l) => l.includes('1/1'))).toBe(true);
  });

  it('dbPush creates the missing table and unique index inside a transaction', async () => {
    const ddl = new MockDb();
    const app = makeApp(ddl);

    await dbPush(app);

    expect(ddl.of('createTable')).toHaveLength(1);
    const idxs = ddl.of('addIndex');
    expect(idxs).toHaveLength(1);
    expect((idxs[0].args[0] as DbIndex).name).toBe('idx_user_email');
    expect(app.modules.sql.get()?.beginTransaction).toHaveBeenCalled();
  });

  it('dbSql writes a migration file with the change SQL', async () => {
    const ddl = new MockDb();
    const app = makeApp(ddl);
    const dir = mkdtempSync(join(tmpdir(), 'kadmium-dbsql-'));
    dirs.push(dir);
    const file = resolve(join(dir, 'init.sql'));

    await dbSql(app, file);

    expect(existsSync(file)).toBe(true);
    const sql = readFileSync(file, 'utf8');
    expect(sql).toContain('CREATE TABLE "user"');
    expect(sql).toContain('idx_user_email');
  });

  it('dbClear without force does not drop anything', async () => {
    const ddl = new MockDb();
    ddl.tables = [{ name: 'users' }];
    const app = makeApp(ddl);

    await dbClear(app, false);

    expect(ddl.of('dropTable')).toHaveLength(0);
  });

  it('dbClear with force drops every inspected table', async () => {
    const ddl = new MockDb();
    ddl.tables = [{ name: 'users' }, { name: 'posts' }];
    const app = makeApp(ddl);

    await dbClear(app, true);

    expect(ddl.of('dropTable').map((c) => c.args[0])).toEqual([
      'users',
      'posts',
    ]);
  });
});
