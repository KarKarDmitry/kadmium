/**
 * @karkardmitry/kadmium-sql-types
 * Type definitions for SQL adapters.
 * Core depends on this, adapters implement it.
 */

// ── AST types (read-only view for adapter) ──

export interface WhereCondition {
  alias?: string;
  field: string;
  /** Имя колонки в БД (FieldIR.alias ?? field) */
  column?: string;
  op: string;
  value: unknown;
}

export interface WhereGroup {
  op: 'AND' | 'OR';
  conditions: Array<WhereCondition | WhereGroup>;
}

export interface SelectableField {
  readonly kind: 'selectable';
  readonly tableAlias: string;
  readonly fieldName: string;
  readonly alias?: string;
  readonly aggregate?: string;
  /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
  readonly column?: string;
  toSql(): string;
}

export interface AggregateSelectable {
  readonly kind: 'aggregate';
  readonly tableAlias: string;
  readonly fieldName: string;
  readonly alias?: string;
  toSql(): string;
}

/** Элемент SELECT: обычное поле или агрегат. */
export type SelectItem = SelectableField | AggregateSelectable;

export interface JoinOptions {
  left: string;
  right: string;
  direction?: 'inner' | 'left' | 'right' | 'outer';
  on?: WhereCondition | WhereGroup;
}

export interface IncludedRelation {
  parentAlias: string;
  propertyName: string;
  relationType: 'one-to-one' | 'one-to-many' | 'many-to-one';
  parentField: string;
  childField: string;
  internalSqb: ReadonlySqb;
  targetIr: {
    name: string;
    collection: string;
    fields: Record<
      string,
      { type?: string; sourceModel?: string; alias?: string }
    >;
  };
}

export interface ReadonlySqb {
  readonly operation: 'select' | 'update' | 'delete' | 'upsert';
  readonly tableContext: ReadonlyMap<string, string>;
  readonly wheres: WhereGroup;
  readonly selects: readonly SelectItem[] | null;
  readonly joins: readonly JoinOptions[];
  readonly includes: readonly IncludedRelation[];
  readonly orders: readonly {
    field: string;
    column?: string;
    direction: 'asc' | 'desc';
  }[];
  readonly limit: number | null;
  readonly offset: number | null;
  readonly groupBy: readonly string[];
  /** Data for UPDATE operations */
  readonly updateData: Record<string, unknown> | null;
  /** Data for UPSERT operations */
  readonly upsertData: Record<string, unknown> | null;
  /** Column(s) for ON CONFLICT clause */
  readonly conflictTarget: string[] | null;
  /** ON CONFLICT DO NOTHING instead of DO UPDATE */
  readonly doNothing: boolean;
}

// ── Adapter interface ──

export interface SqlAdapter {
  /** Convert SQB to SQL with parameters */
  toSql(sqb: ReadonlySqb): { text: string; values: unknown[] };

  /** Execute a query */
  execute(sqb: ReadonlySqb): Promise<Record<string, unknown>[]>;

  /** Raw SQL execution */
  raw<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Create a record */
  create(
    collectionName: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /** Create multiple records in a single query */
  createMany(
    collectionName: string,
    data: Record<string, unknown>[],
    options?: { transaction?: boolean },
  ): Promise<Record<string, unknown>[]>;

  /** DDL operations */
  ddl: DbDdlAdapter;

  /** Begin a transaction */
  beginTransaction(): Promise<TransactionalAdapter>;

  /** Close the connection pool (optional) */
  end?(): Promise<void>;
}

export interface TransactionalAdapter extends SqlAdapter {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
}

// ── DDL types ──

export interface DbTable {
  name: string;
}

export interface DbColumn {
  name: string;
  tableName: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
  isUnique: boolean;
  autoIncrement?: boolean;
}

export interface DbIndex {
  name: string;
  tableName: string;
  columns: string[];
  isUnique: boolean;
}

export interface DbForeignKey {
  name: string;
  tableName: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'SET DEFAULT';
  onUpdate: 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'SET DEFAULT';
}

export interface DbDdlAdapter {
  inspectTables(): Promise<DbTable[]>;
  inspectColumns(tableName: string): Promise<DbColumn[]>;
  inspectIndexes(tableName: string): Promise<DbIndex[]>;
  inspectForeignKeys(tableName: string): Promise<DbForeignKey[]>;

  createTable(tableName: string, columns: DbColumn[]): Promise<void>;
  addColumn(table: string, col: DbColumn): Promise<void>;
  dropColumn(table: string, colName: string): Promise<void>;
  alterType(table: string, colName: string, newType: string): Promise<void>;
  alterNullable(
    table: string,
    colName: string,
    nullable: boolean,
  ): Promise<void>;
  alterDefault(
    table: string,
    colName: string,
    defaultValue: string | null,
  ): Promise<void>;
  addIndex(idx: DbIndex): Promise<void>;
  dropIndex(indexName: string): Promise<void>;
  addForeignKey(fk: DbForeignKey): Promise<void>;
  dropForeignKey(fkName: string, tableName: string): Promise<void>;
  dropTable(tableName: string): Promise<void>;
  raw(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}
