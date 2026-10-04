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
  condition: WhereCondition | WhereGroup | WhereFragment;
}

export interface WhereGroup {
  elements: WhereStep[];
}

/** WHERE-предикат по sql-фрагменту (E): скомпилированный текст + локальные $N. */
export interface WhereFragment {
  readonly kind: 'sql-condition';
  readonly text: string;
  readonly values: readonly unknown[];
  readonly slotOrder: readonly SlotDefinition[];
}

export type WhereExpression = WhereCondition | WhereGroup | WhereFragment;

/** DML-значение по sql-фрагменту (F): скомпилированный текст + локальные $N. */
export interface SqlValueFragment {
  readonly kind: 'sql-value';
  readonly text: string;
  readonly values: readonly unknown[];
  readonly slotOrder: readonly SlotDefinition[];
}

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

/** ORDER BY по обычной колонке: "alias"."column" DIR. */
export interface OrderColumnStep {
  field: string;
  column?: string;
  tableAlias?: string;
  direction: 'asc' | 'desc';
}

/** ORDER BY по sql-фрагменту (C2): скомпилированный текст + локальные $N. */
export interface OrderFragmentStep {
  kind: 'fragment';
  text: string;
  values: readonly unknown[];
  slotOrder: readonly SlotDefinition[];
  direction: 'asc' | 'desc';
}

/** Шаг ORDER BY: колонка или фрагмент. */
export type OrderStep = OrderColumnStep | OrderFragmentStep;

/** GROUP BY по обычной колонке: "alias"."column". */
export interface GroupByColumnStep {
  readonly kind: 'group-by-column';
  /** Алиас таблицы; отсутствие → mainTableAlias при рендере */
  readonly tableAlias?: string;
  readonly column: string;
}

/** GROUP BY по sql-фрагменту: скомпилированный текст + локальные $N. */
export interface GroupByFragmentStep {
  readonly kind: 'group-by-fragment';
  readonly text: string;
  readonly values: readonly unknown[];
  readonly slotOrder: readonly SlotDefinition[];
}

/** Шаг GROUP BY: колонка или фрагмент. */
export type GroupByStep = GroupByColumnStep | GroupByFragmentStep;

export interface JoinOptions {
  left: string;
  right: string;
  direction?: 'inner' | 'left' | 'right' | 'outer';
  on?: WhereExpression;
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
  /**
   * Маркер multi-запроса (MultiQueryBuilder). Дискриминатор вложенного
   * reshape и prefix-алиасинга колонок (`"alias.field"`): любой multi,
   * включая single-alias (`query({ u: User })`), вложен под алиас; single
   * всегда плоский. Выставляется в core, не меняется в рантайме.
   */
  readonly isMulti?: boolean;
  readonly tableContext: ReadonlyMap<string, string>;
  readonly wheres: WhereGroup;
  readonly havings: WhereGroup;
  /** Cursor-based пагинация: позиция, рендерится AND-членом в WHERE */
  readonly cursor: WhereGroup;
  readonly selects: readonly SelectItem[] | null;
  readonly joins: readonly JoinOptions[];
  readonly includes: readonly IncludedRelation[];
  readonly orders: readonly OrderStep[];
  readonly limit: number | null;
  readonly offset: number | null;
  readonly groupBy: readonly GroupByStep[];
  /** Data for UPDATE operations */
  readonly updateData: Record<string, unknown> | null;
  /** Data for UPSERT operations */
  readonly upsertData: Record<string, unknown> | null;
  /** DO UPDATE SET-выражения для ON CONFLICT (F): ключ → значение или sql-фрагмент */
  readonly upsertSetData: Record<string, unknown> | null;
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
      /** DO UPDATE SET-выражения для ON CONFLICT (F): ключ → значение или sql-фрагмент */
      setData?: Record<string, unknown>;
      /**
       * Проекция RETURNING: те же SelectItem, что и в `ReadonlySqb.selects`.
       * `null`/пусто → `RETURNING *`. Адаптер рендерит их в порядке,
       * указанном здесь, после VALUES и ON CONFLICT.
       */
      returning?: readonly SelectItem[] | null;
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

/**
 * Referential action в канонической форме — ровно та строка, что уходит в
 * `ALTER TABLE ... ON DELETE`.
 *
 * Форма, в которой действие пишет модель, — в нижнем регистре; маппинг между
 * ними живёт в core (`ReferentialActionInput` → `toReferentialAction`).
 */
export type ReferentialAction =
  'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'SET DEFAULT';

export interface DbForeignKey {
  name: string;
  tableName: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
}

// ── Schema diff: operations ──
//
// Контракт миграций живёт здесь, а не в пакете адаптера: `computeDiff()` и
// `applyDiff()` одинаковы для любого диалекта и отличаются только интроспекцией
// (`DbDdlAdapter`) и отображением типов (`Dialect`). Пока эти операции были
// типами пакета адаптера, `core` был обязан импортировать этот адаптер — при
// установке из npm `kadmium db:*` падал с MODULE_NOT_FOUND.

export interface AddColumnOp {
  type: 'add-column';
  table: string;
  column: DbColumn;
}

export interface DropColumnOp {
  type: 'drop-column';
  table: string;
  columnName: string;
}

export interface AlterTypeOp {
  type: 'alter-type';
  table: string;
  columnName: string;
  oldType: string;
  newType: string;
}

export interface AlterNullableOp {
  type: 'alter-nullable';
  table: string;
  columnName: string;
  oldNullable: boolean;
  newNullable: boolean;
}

/**
 * Смена `DEFAULT` существующей колонки.
 *
 * `newDefault === null` означает `DROP DEFAULT` — так же, как `null` в
 * `DbColumn.defaultValue` означает отсутствие дефолта при создании.
 * Сравнение с базой идёт через `Dialect.defaultsEqual()`, а не `===`: PostgreSQL
 * хранит переписанный разбором литерал, поэтому текстовое равенство для
 * временных типов не наступает никогда.
 */
export interface AlterDefaultOp {
  type: 'alter-default';
  table: string;
  columnName: string;
  oldDefault: string | null;
  newDefault: string | null;
}

export interface AddIndexOp {
  type: 'add-index';
  index: DbIndex;
}

export interface DropIndexOp {
  type: 'drop-index';
  indexName: string;
  tableName: string;
}

export interface AddForeignKeyOp {
  type: 'add-foreign-key';
  fk: DbForeignKey;
}

export interface DropForeignKeyOp {
  type: 'drop-foreign-key';
  fkName: string;
  tableName: string;
}

/**
 * Смена определения существующего FK: действия, целевой таблицы или колонок.
 *
 * Отдельная операция, а не пара `drop-foreign-key` + `add-foreign-key`, потому
 * что `checkHealth` считает добавленный FK «отсутствующим ограничением» и
 * покраснел бы на исправной схеме. Postgres не умеет ALTER CONSTRAINT по
 * частям — внутри операции ограничение пересоздаётся, но для диффа и для
 * отчёта это изменение существующего FK, а не появление нового.
 */
export interface AlterForeignKeyOp {
  type: 'alter-foreign-key';
  fkName: string;
  tableName: string;
  oldFk: DbForeignKey;
  newFk: DbForeignKey;
}

export interface CreateTableOp {
  type: 'create-table';
  table: string;
  columns: DbColumn[];
}

export interface DropTableOp {
  type: 'drop-table';
  table: string;
}

export type DiffOp =
  | AddColumnOp
  | DropColumnOp
  | AlterTypeOp
  | AlterNullableOp
  | AlterDefaultOp
  | AddIndexOp
  | DropIndexOp
  | AddForeignKeyOp
  | DropForeignKeyOp
  | AlterForeignKeyOp
  | CreateTableOp
  | DropTableOp;

export interface DiffResult {
  operations: DiffOp[];
  hasChanges: boolean;
  summary: {
    addedTables: number;
    droppedTables: number;
    addedColumns: number;
    droppedColumns: number;
    alteredColumns: number;
    alteredDefaults: number;
    addedIndexes: number;
    droppedIndexes: number;
    addedForeignKeys: number;
    droppedForeignKeys: number;
    alteredForeignKeys: number;
  };
}

export interface HealthCheckResult {
  isHealthy: boolean;
  issues: string[];
  summary: {
    tablesMissing: number;
    tablesExpected: number;
    tablesMatching: number;
  };
}

// ── Schema diff: input ──

/**
 * Поле IR в том виде, в котором его видит миграция.
 *
 * Структурный тип: `FieldIR` из `core/ir` ему удовлетворяет без правок — у
 * него `type: FieldType` (assignable в `string`), тот же набор `relation` и
 * уже канонические `ReferentialAction`. Держим копию, а не импорт, по двум
 * причинам: `core` не должен зависеть от адаптера, а IR — это публичный
 * контракт, который собирают руками и передают в `computeDiff()` напрямую.
 */
export type IrField = {
  type: string;
  ref?: string;
  sourceModel?: string;
  nullable: boolean;
  unique: boolean;
  index?: boolean;
  isPrimary?: boolean;
  alias?: string;
  spec?: Record<string, unknown>;
  /** Тип связи из model DSL. */
  relation?: 'one-to-many' | 'many-to-one' | 'one-to-one';
  /** ON DELETE из model DSL; уже в канонической форме, маппинг — в core. */
  onDelete?: ReferentialAction;
  /** ON UPDATE из model DSL; уже в канонической форме, маппинг — в core. */
  onUpdate?: ReferentialAction;
};

/**
 * Модель в том виде, в котором её видит миграция.
 *
 * `collection` — не описание, а имя таблицы: `computeDiff()` строит из него
 * множество ожидаемых таблиц и по нему же понимает, какую таблицу в базе
 * считать лишней.
 */
export interface IrModel {
  name: string;
  collection: string;
  fields: Record<string, IrField>;
}

/**
 * Диалект: всё, чем миграция отличается от диалекта до базы.
 *
 * `computeDiff()` одинаков для любой базы — он сравнивает IR с результатом
 * интроспекции. Различаются только две вещи: как имя типа из IR превращается
 * в SQL-тип (`typeName`) и как выглядит `DEFAULT` (`renderDefault`).
 * Пока эти функции лежали в пакете адаптера, `core` был обязан импортировать
 * адаптер целиком.
 *
 * `serializeValue()` и `supports()` появятся вместе с потребителями —
 * сериализацией `Duration` (R7) и проверкой поддержки типа на DDL. Не
 * добавляю их заранее: метод без вызывающего кода — это контракт, который
 * придётся ломать при первом же изменении.
 */
export interface Dialect {
  /**
   * Имя SQL-типа для поля. `irs` нужен для `ref`: тип колонки-ссылки
   * определяется через тип PK целевой модели.
   */
  typeName(field: IrField, irs: readonly IrModel[]): string;

  /** Нормализовать имя типа из интроспекции для сверки. */
  normalizeTypeName(name: string): string;

  /**
   * Отрендерить `DEFAULT` как SQL-литерал. `null` — дефолта нет.
   *
   * Возвращает готовый текст, а не значение: у PostgreSQL нет параметров в
   * DDL, поэтому литерал всё равно окажется в строке запроса.
   */
  renderDefault(field: IrField): string | null;

  /**
   * Равны ли дефолт из модели и дефолт, отданный базой.
   *
   * Сверка идёт только этим методом, а не `===`: база хранит переписанный
   * разбором литерал, и для временных типов текстовое равенство не наступает
   * никогда. `null` означает «дефолта нет» с обеих сторон.
   */
  defaultsEqual(
    field: IrField,
    expected: string | null,
    actual: string | null,
  ): boolean;

  /**
   * Текст DDL-превью для набора операций — то, что `kadmium db:sql`
   * показывает пользователю.
   *
   * Метод на диалекте, а не на адаптере: превью нужно там же, где считается
   * дифф (диалект), и не требует соединения с базой. Возвращается ровно то,
   * что выполнит `db:migrate`, — оба рендера обязаны звать одни и те же
   * statement builders адаптера, иначе `db:sql` начнёт обещать не то.
   */
  renderSql(diff: DiffResult): string;
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
