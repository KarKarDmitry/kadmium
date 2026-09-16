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

/** Шаг последовательности: с каким join присоединяется условие */
export interface WhereStep {
  join: 'AND' | 'OR';
  condition: WhereCondition | WhereGroup;
}

export interface WhereGroup {
  elements: WhereStep[];
}

export type WhereExpression = WhereCondition | WhereGroup;

export interface SelectableField {
  readonly kind: 'selectable';
  readonly tableAlias: string;
  readonly fieldName: string;
  readonly alias?: string;
  readonly aggregate?: string;
  /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
  readonly column?: string;
}

export interface AggregateSelectable {
  readonly kind: 'aggregate';
  readonly tableAlias: string;
  readonly fieldName: string;
  /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
  readonly column?: string;
  readonly alias?: string;
  /** Агрегатная функция: count | sum | avg | min | max */
  readonly func?: string;
}

/** Граница фрейма ROWS (число — смещение строк: 1→PRECEDING, -2→FOLLOWING). */
export type WindowFrameBound = number | 'unbounded' | 'current';

export interface WindowSelectable {
  readonly kind: 'window';
  readonly tableAlias: string;
  readonly fieldName: string;
  /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
  readonly column?: string;
  readonly alias?: string;
  /** Функция окна: row_number | rank | ... | lag | lead | ntile | count (оконный агрегат) */
  readonly func?: string;
  /** true — оконный агрегат: тело рендерится как агрегат, хвост — OVER */
  readonly aggregate?: boolean;
  /** Параметры-аргументы (ntile(n), lag offset/default, nth_value(n)) */
  readonly args?: readonly (number | string | boolean | null)[];
  /** Спецификация окна: OVER (...); пустая → OVER () */
  readonly over?: {
    readonly partitionBy: readonly {
      tableAlias: string;
      fieldName: string;
      column?: string;
    }[];
    readonly orderBy: readonly {
      tableAlias: string;
      fieldName: string;
      column?: string;
      direction: 'asc' | 'desc';
    }[];
    readonly frame: readonly [WindowFrameBound, WindowFrameBound] | null;
  };
}

/** Элемент SELECT: поле, агрегат, оконная функция или сырой sql-фрагмент. SQL рендерит адаптер из структуры. */
export type SelectItem =
  SelectableField | AggregateSelectable | WindowSelectable | SqlSelectItem;

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
  readonly havings: WhereGroup;
  /** Cursor-based пагинация: позиция, рендерится AND-членом в WHERE */
  readonly cursor: WhereGroup;
  readonly selects: readonly SelectItem[] | null;
  readonly joins: readonly JoinOptions[];
  readonly includes: readonly IncludedRelation[];
  readonly orders: readonly {
    field: string;
    column?: string;
    tableAlias?: string;
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

// ── Slot markers (compiled queries, План 3) ──

/**
 * Маркер именованного слота — placeholder для значения, заполняемого
 * compile().fill({...}) (B1/B2). В sql-pg никак не находится в рантайме
 * (duck-typing по kind === 'slot'), в core — класс SlotMarker из orm/slot.ts.
 */
export interface HoleRef {
  readonly kind: 'slot';
  readonly slotName: string;
}

/** Резервный идентификатор в контракте */
export interface SlotDefinition {
  readonly name: string;
  readonly index: number;
}

/** Сырой sql-фрагмент в SELECT: предрендеренный текст + параметры фрагмента (C2). */
export interface SqlSelectItem {
  readonly kind: 'sql-item';
  readonly alias: string;
  /** Текст фрагмента с локальными $1..$N (сдвигается на текущий paramIndex). */
  readonly text: string;
  readonly values: readonly unknown[];
  readonly slotOrder: readonly SlotDefinition[];
}

/**
 * Скомпилированный запрос (План 3, B1B2): SQL-текст с $N-плейсхолдерами,
 * значения (маркеры слотов на месте ожидания fill) и порядок слотов.
 * `sqb` — снапшот контекста (selects/includes/tableContext) для reshape
 * результата; `TSlots`/`TResult` — type-only (fill и go в B2).
 */
export type CompiledQuery<
  TSlots extends Record<string, unknown> = Record<string, never>,
  TResult = unknown,
> = {
  readonly text: string;
  readonly values: (unknown | HoleRef)[];
  readonly slotOrder: SlotDefinition[];
  /** type-only бренд слота-мапы — typed fill; runtime-значения не пишутся */
  readonly _slots: TSlots;
  /** type-only бренд результата — типизирует go() раннера; runtime-значения нет */
  readonly _result?: TResult;
  /** single-режим (first()): run().go() разворачивает rows[0], как go() билдера */
  readonly single: boolean;
  /** Снапшот sqb после materializeSelects — reshape-контекст (B2) */
  readonly sqb: ReadonlySqb;
};

// ── Adapter interface ──

export interface SqlAdapter {
  /** Convert SQB to SQL with parameters */
  toSql(sqb: ReadonlySqb): {
    text: string;
    values: unknown[];
    /** Именованные слоты в порядке первого вхождения (пуст, когда слотов нет) */
    slotOrder?: SlotDefinition[];
  };

  /** Execute a query */
  execute(sqb: ReadonlySqb): Promise<Record<string, unknown>[]>;

  /** Превратить плоские строки в результат под контекст запроса (unpack includes + multi-reshape). */
  reshape(
    sqb: ReadonlySqb,
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[];

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
    options?: {
      transaction?: boolean;
      /** Column(s) for ON CONFLICT — batches become multi-row upsert */
      conflictTarget?: string[];
      /** ON CONFLICT DO NOTHING instead of DO UPDATE */
      doNothing?: boolean;
    },
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
  /** Batched introspection — one round trip for all requested tables (rows carry tableName). */
  inspectAllColumns(tableNames: string[]): Promise<DbColumn[]>;
  inspectAllIndexes(tableNames: string[]): Promise<DbIndex[]>;
  inspectAllForeignKeys(tableNames: string[]): Promise<DbForeignKey[]>;

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

// ── Input types ──

/** Input for create operations — keys must be subset of model fields, all optional. */
export type CreateInput<T> = Partial<T>;

/** Input for update operations — keys must be subset of model fields, all optional. */
export type UpdateInput<T> = Partial<T>;
