import type {
  DbColumn,
  DbDdlAdapter,
  DbForeignKey,
  DbIndex,
  DbTable,
} from '@karkardmitry/kadmium-sql-types';
import type {
  AddColumnOp,
  AddForeignKeyOp,
  AddIndexOp,
  AlterNullableOp,
  AlterTypeOp,
  CreateTableOp,
  DiffOp,
  DiffResult,
  DropColumnOp,
  DropForeignKeyOp,
  DropIndexOp,
  DropTableOp,
  IrField,
} from '../../src/diff/types';

export const userFields: Record<string, IrField> = {
  id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
  name: { type: 'string', nullable: false, unique: false },
  email: { type: 'string', nullable: false, unique: true },
};

export const postFields: Record<string, IrField> = {
  id: { type: 'primary', nullable: false, unique: true, isPrimary: true },
  title: { type: 'string', nullable: false, unique: false },
  author: { type: 'ref', ref: 'User', nullable: false, unique: false },
};

/** Two models: User → Post (ref). Missing `collection` is the only diff vs types.test. */
export const irs = [
  { name: 'User', collection: 'users', fields: userFields },
  { name: 'Post', collection: 'posts', fields: postFields },
];

export const userColumns: DbColumn[] = [
  {
    name: 'id',
    tableName: 'users',
    dataType: 'integer',
    isNullable: false,
    defaultValue: null,
    isPrimary: true,
    isUnique: true,
    autoIncrement: true,
  },
  {
    name: 'name',
    tableName: 'users',
    dataType: 'character varying',
    isNullable: false,
    defaultValue: null,
    isPrimary: false,
    isUnique: false,
  },
  {
    name: 'email',
    tableName: 'users',
    dataType: 'character varying',
    isNullable: false,
    defaultValue: null,
    isPrimary: false,
    isUnique: true,
  },
];

export const postColumns: DbColumn[] = [
  {
    name: 'id',
    tableName: 'posts',
    dataType: 'integer',
    isNullable: false,
    defaultValue: null,
    isPrimary: true,
    isUnique: true,
    autoIncrement: true,
  },
  {
    name: 'title',
    tableName: 'posts',
    dataType: 'character varying',
    isNullable: false,
    defaultValue: null,
    isPrimary: false,
    isUnique: false,
  },
  {
    name: 'author',
    tableName: 'posts',
    dataType: 'integer',
    isNullable: false,
    defaultValue: null,
    isPrimary: false,
    isUnique: false,
  },
];

/** Recorded DDL call, for asserting applyDiff order and payloads. */
export interface DdlCall {
  method: string;
  args: unknown[];
}

/**
 * In-memory DbDdlAdapter. State is preset by tests; every call is recorded
 * instead of touching a real database.
 */
export class MockDdl implements DbDdlAdapter {
  tables: DbTable[] = [];
  columns = new Map<string, DbColumn[]>();
  indexes = new Map<string, DbIndex[]>();
  foreignKeys = new Map<string, DbForeignKey[]>();
  calls: DdlCall[] = [];

  /**
   * @param failOn — when it returns true for a method name, that
   * method throws, simulating a PostgreSQL error mid-apply.
   */
  constructor(private failOn: (method: string) => boolean = () => false) {}

  setSchema(
    tables: DbTable[],
    columns?: Record<string, DbColumn[]>,
    indexes?: Record<string, DbIndex[]>,
    foreignKeys?: Record<string, DbForeignKey[]>,
  ): void {
    this.tables = tables;
    this.columns = new Map(Object.entries(columns ?? {}));
    this.indexes = new Map(Object.entries(indexes ?? {}));
    this.foreignKeys = new Map(Object.entries(foreignKeys ?? {}));
  }

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
    if (this.failOn(method)) throw new Error(`boom: ${method}`);
  }

  async inspectTables(): Promise<DbTable[]> {
    this.record('inspectTables', []);
    return this.tables;
  }

  async inspectColumns(tableName: string): Promise<DbColumn[]> {
    this.record('inspectColumns', [tableName]);
    return this.columns.get(tableName) ?? [];
  }

  async inspectIndexes(tableName: string): Promise<DbIndex[]> {
    this.record('inspectIndexes', [tableName]);
    return this.indexes.get(tableName) ?? [];
  }

  async inspectForeignKeys(tableName: string): Promise<DbForeignKey[]> {
    this.record('inspectForeignKeys', [tableName]);
    return this.foreignKeys.get(tableName) ?? [];
  }

  async createTable(tableName: string, columns: DbColumn[]): Promise<void> {
    this.record('createTable', [tableName, columns]);
  }

  async addColumn(table: string, col: DbColumn): Promise<void> {
    this.record('addColumn', [table, col]);
  }

  async dropColumn(table: string, colName: string): Promise<void> {
    this.record('dropColumn', [table, colName]);
  }

  async alterType(table: string, colName: string, newType: string): Promise<void> {
    this.record('alterType', [table, colName, newType]);
  }

  async alterNullable(
    table: string,
    colName: string,
    nullable: boolean,
  ): Promise<void> {
    this.record('alterNullable', [table, colName, nullable]);
  }

  async alterDefault(
    table: string,
    colName: string,
    defaultValue: string | null,
  ): Promise<void> {
    this.record('alterDefault', [table, colName, defaultValue]);
  }

  async addIndex(idx: DbIndex): Promise<void> {
    this.record('addIndex', [idx]);
  }

  async dropIndex(indexName: string): Promise<void> {
    this.record('dropIndex', [indexName]);
  }

  async addForeignKey(fk: DbForeignKey): Promise<void> {
    this.record('addForeignKey', [fk]);
  }

  async dropForeignKey(fkName: string, tableName: string): Promise<void> {
    this.record('dropForeignKey', [fkName, tableName]);
  }

  async dropTable(tableName: string): Promise<void> {
    this.record('dropTable', [tableName]);
  }

  async raw(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    this.record('raw', [sql, params]);
    return [];
  }

  methodCalls(method: string): DdlCall[] {
    return this.calls.filter((c) => c.method === method);
  }
}

/* ── Diff op builders ── */

export const userIndex: DbIndex = {
  name: 'idx_users_email',
  tableName: 'users',
  columns: ['email'],
  isUnique: true,
};

export const userPkColumn: DbColumn = {
  name: 'id',
  tableName: 'users',
  dataType: 'integer',
  isNullable: false,
  defaultValue: null,
  isPrimary: true,
  isUnique: true,
  autoIncrement: true,
};

export const createUsersOp = (): CreateTableOp => ({
  type: 'create-table',
  table: 'users',
  columns: [
    userPkColumn,
    {
      name: 'name',
      tableName: 'users',
      dataType: 'character varying',
      isNullable: false,
      defaultValue: null,
      isPrimary: false,
      isUnique: false,
    },
    {
      name: 'email',
      tableName: 'users',
      dataType: 'character varying',
      isNullable: false,
      defaultValue: null,
      isPrimary: false,
      isUnique: true,
    },
  ],
});

export const addEmailIndexOp = (): AddIndexOp => ({
  type: 'add-index',
  index: userIndex,
});

export const addTitleColumnOp = (): AddColumnOp => ({
  type: 'add-column',
  table: 'posts',
  column: {
    name: 'title',
    tableName: 'posts',
    dataType: 'character varying',
    isNullable: false,
    defaultValue: null,
    isPrimary: false,
    isUnique: false,
  },
});

export const dropLegacyColumnOp = (): DropColumnOp => ({
  type: 'drop-column',
  table: 'posts',
  columnName: 'legacy',
});

export const alterAuthorTypeOp = (): AlterTypeOp => ({
  type: 'alter-type',
  table: 'posts',
  columnName: 'author',
  oldType: 'bigint',
  newType: 'integer',
});

export const alterNameNullableOp = (): AlterNullableOp => ({
  type: 'alter-nullable',
  table: 'users',
  columnName: 'name',
  oldNullable: true,
  newNullable: false,
});

export const addFkOp = (): AddForeignKeyOp => ({
  type: 'add-foreign-key',
  fk: {
    name: 'fk_posts_author',
    tableName: 'posts',
    columns: ['author'],
    refTable: 'user',
    refColumns: ['id'],
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  },
});

export const dropCategoryFkOp = (): DropForeignKeyOp => ({
  type: 'drop-foreign-key',
  fkName: 'fk_posts_category',
  tableName: 'posts',
});

export const addLegacyIndexOp = (): AddIndexOp => ({
  type: 'add-index',
  index: {
    name: 'idx_posts_legacy',
    tableName: 'posts',
    columns: ['legacy'],
    isUnique: false,
  },
});

export const dropLegacyIndexOp = (): DropIndexOp => ({
  type: 'drop-index',
  indexName: 'idx_posts_legacy',
  tableName: 'posts',
});

export const dropPostsOp = (): DropTableOp => ({
  type: 'drop-table',
  table: 'posts',
});

export function diff(
  operations: DiffOp[],
  summary?: Partial<DiffResult['summary']>,
): DiffResult {
  return {
    operations,
    hasChanges: operations.length > 0,
    summary: {
      addedTables: 0,
      droppedTables: 0,
      addedColumns: 0,
      droppedColumns: 0,
      alteredColumns: 0,
      addedIndexes: 0,
      droppedIndexes: 0,
      addedForeignKeys: 0,
      droppedForeignKeys: 0,
      ...summary,
    },
  };
}