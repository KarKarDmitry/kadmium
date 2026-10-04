import type {
  DbColumn,
  DbDdlAdapter,
  DbForeignKey,
  DbIndex,
  DbTable,
  Dialect,
  IrField,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';

/**
 * Диалект-заглушка для тестов движка.
 *
 * Ответы повторяют PostgreSQL ровно настолько, чтобы ожидания в тестах
 * читались как раньше. Проверять тут нечего: правильность `pgType` проверяет
 * `sql-pg` (`test/dialect.test.ts`), а тест движка должен убедиться, что он
 * спрашивает диалект и уважает ответ.
 */
export const stubDialect: Dialect = {
  typeName(f: IrField): string {
    if (f.type === 'primary') return 'integer';
    if (f.type === 'ref') return 'integer';
    if (f.type === 'string') return 'character varying';
    return 'text';
  },
  normalizeTypeName(name: string): string {
    return name.toLowerCase();
  },
  renderDefault(): string | null {
    return null;
  },
  defaultsEqual(
    _f: IrField,
    expected: string | null,
    actual: string | null,
  ): boolean {
    return expected === actual;
  },
};

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

/** Two models: User → Post (ref). */
export const irs: IrModel[] = [
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

  async inspectAllColumns(tableNames: string[]): Promise<DbColumn[]> {
    this.record('inspectAllColumns', [tableNames]);
    return tableNames.flatMap((t) => this.columns.get(t) ?? []);
  }

  async inspectAllIndexes(tableNames: string[]): Promise<DbIndex[]> {
    this.record('inspectAllIndexes', [tableNames]);
    return tableNames.flatMap((t) => this.indexes.get(t) ?? []);
  }

  async inspectAllForeignKeys(tableNames: string[]): Promise<DbForeignKey[]> {
    this.record('inspectAllForeignKeys', [tableNames]);
    return tableNames.flatMap((t) => this.foreignKeys.get(t) ?? []);
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

  async alterType(
    table: string,
    colName: string,
    newType: string,
  ): Promise<void> {
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

  async raw(): Promise<Record<string, unknown>[]> {
    this.record('raw', []);
    return [];
  }

  methodCalls(method: string): DdlCall[] {
    return this.calls.filter((c) => c.method === method);
  }
}
