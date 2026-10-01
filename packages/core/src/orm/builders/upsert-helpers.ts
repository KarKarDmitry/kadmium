import type { KadmiumSqb, AnySelectableField } from '../sqb';
import type { ModelIR } from '../../ir/index';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { SelectableField } from '../ast/selectable';
import type { AnySelectable, FlatFinalResult } from '../types/includes';
import type { SelectProxy, FilterProxy, ReturningTools } from '../types/proxy';
import type { SetData } from '../types/dml-data';
import { createSelectProxy, createFilterProxy } from './query-proxies';
import { toSqlValue } from '../sql-fragment';
import { aggregates } from '../field-builders/aggregates';
import { buildDebugSql, mapRow } from './utils';

// ── Types ──

type Model = { ['~shape']: Record<string, unknown> };

/**
 * Данные DO UPDATE SET: объект значений или коллбэк с типизированным proxy (F).
 *
 * Здесь коллбэк остаётся: в `DO UPDATE SET` доступна целевая таблица, поэтому
 * ссылка на колонку валидна — `set((p) => ({ views: sql`${p.views} + 1` }))`.
 * В `values()` его нет (см. `types/dml-data`).
 */
type DmlData<TModel extends Model> = SetData<TModel>;

export interface CreateFinalizer<TModel extends Model> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => CreateFinalizer<TModel>;
  doNothing: () => CreateFinalizer<TModel>;
  /** DO UPDATE SET-выражения для ON CONFLICT (F): обычные значения или sql-фрагменты. */
  set: (data: DmlData<TModel>) => CreateFinalizer<TModel>;
  /**
   * Проекция RETURNING: `sqb.selects` рендерится в RETURNING-клаузу
   * (тот же путь, что у `update()/delete().returning()`). Без вызова —
   * `RETURNING *` и полная модель через mapRow.
   */
  returning: <S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ) => CreateReturningFinalizer<S>;
  go: () => Promise<TModel['~shape']>;
  sql: () => string;
}

/** Результат `create().returning(...)`: плоская проекция, а не полная модель. */
export interface CreateReturningFinalizer<S extends readonly AnySelectable[]> {
  go: () => Promise<FlatFinalResult<S>>;
  sql: () => string;
}

export interface CreateManyFinalizer<TModel extends Model> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => CreateManyFinalizer<TModel>;
  doNothing: () => CreateManyFinalizer<TModel>;
  /** DO UPDATE SET-выражения для ON CONFLICT (F): обычные значения или sql-фрагменты. */
  set: (data: DmlData<TModel>) => CreateManyFinalizer<TModel>;
  /** Проекция RETURNING — применяется к каждой строке батча. */
  returning: <S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ) => {
    go: () => Promise<FlatFinalResult<S>[]>;
    sql: () => string;
  };
  go: () => Promise<TModel['~shape'][]>;
  sql: () => string;
}

export interface CreateManyOptions {
  transaction?: boolean;
}

/** Три конфликтных шага, общих для `create` и `createMany`. */
export interface ConflictSteps<TModel extends Model, TFinal> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => TFinal;
  doNothing: () => TFinal;
  set: (data: DmlData<TModel>) => TFinal;
}

/**
 * Собрать конфликтные шаги для финализатора. `rebuild` возвращает новый
 * экземпляр финализатора, поэтому шаги остаются флоушими.
 *
 * Вынесено отдельно от двух `build*Finalizer`: иначе `onConflict`/`doNothing`/
 * `set` дублируются почти слово в слово, а правка в одной копии молча
 * разъезжается со второй.
 */
export function buildConflictSteps<TModel extends Model, TFinal>(
  sqb: KadmiumSqb,
  ir: ModelIR,
  rebuild: () => TFinal,
): ConflictSteps<TModel, TFinal> {
  return {
    onConflict: (fn) => {
      sqb.conflictTarget = extractFieldNames<TModel>(ir, fn);
      return rebuild();
    },
    doNothing: () => {
      sqb.doNothing = true;
      return rebuild();
    },
    set: (data) => {
      applySet<TModel>(sqb, ir, data);
      return rebuild();
    },
  };
}

// ── Helpers ──

function extractFieldNames<TModel extends Model>(
  ir: ModelIR,
  fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
): string[] {
  const proxy = createSelectProxy('__upsert', ir);
  const fields = fn(proxy as unknown as SelectProxy<TModel>);
  return fields.map((f) => ir.fields[f.fieldName]?.alias ?? f.fieldName);
}

/**
 * Маппинг DML-данных: коллбэк с proxy → объект, ключи prop→alias,
 * значения через toSqlValue (SqlFragment → SqlValue). Алиас прокси — имя
 * таблицы (ir.collection): валидная ссылка в ON CONFLICT DO UPDATE SET.
 */
function mapDmlData<TModel extends Model>(
  ir: ModelIR,
  sqb: KadmiumSqb,
  alias: string,
  input: DmlData<TModel>,
): Record<string, unknown> {
  const data =
    typeof input === 'function'
      ? input(
          createFilterProxy(alias, ir, sqb) as unknown as FilterProxy<TModel>,
        )
      : input;
  const mapped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    mapped[ir.fields[k]?.alias ?? k] = toSqlValue(v);
  }
  return mapped;
}

function applySet<TModel extends Model>(
  sqb: KadmiumSqb,
  ir: ModelIR,
  input: DmlData<TModel>,
): void {
  if (!sqb.conflictTarget) throw new Error('set() requires onConflict() first');
  sqb.upsertSetData = mapDmlData<TModel>(ir, sqb, ir.collection, input);
}

/**
 * Выставить проекцию RETURNING в sqb и вернуть сборщик селектов.
 *
 * Алиас селекта = tableContext-алиас, под которым рендерится RETURNING,
 * — поэтому здесь берётся `ir.name` (первый ключ tableContext), а не
 * collection: `create` регистрирует таблицу как `ir.name → ir.collection`.
 */
function applyReturning<TModel extends Model>(
  sqb: KadmiumSqb,
  ir: ModelIR,
  fn: (
    t: SelectProxy<TModel>,
    tools: ReturningTools,
  ) => readonly AnySelectable[],
): AnySelectableField[] {
  const alias = [...sqb.tableContext.keys()][0] ?? ir.name;
  const selects = fn(
    createSelectProxy(alias, ir) as unknown as SelectProxy<TModel>,
    {
      agg: aggregates,
    },
  );
  sqb.selects = [...selects] as AnySelectableField[];
  return sqb.selects;
}

/**
 * Маппинг строки RETURNING: оставить только запрошенные ключи, по алиасу
 * селекта (PG возвращает колонки под именем `AS "<alias>"`).
 */
function mapReturningRow(
  row: Record<string, unknown>,
  selects: AnySelectableField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const sel of selects) {
    const key = sel.alias ?? sel.fieldName;
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

// ── Single row create finalizer ──

export function buildCreateFinalizer<TModel extends Model>(
  sqb: KadmiumSqb,
  adapter: SqlAdapter,
  ir: ModelIR,
  mapped: Record<string, unknown>,
): CreateFinalizer<TModel> {
  sqb.operation = 'upsert';
  sqb.upsertData = mapped;

  const _finalize = <
    S extends readonly AnySelectable[],
  >(): CreateFinalizer<TModel> => ({
    ...buildConflictSteps<TModel, CreateFinalizer<TModel>>(sqb, ir, _finalize),
    returning: (fn) => {
      const selects = applyReturning<TModel>(sqb, ir, fn);
      const finalizer: CreateReturningFinalizer<S> = {
        go: async () => {
          const rows = await adapter.execute(sqb);
          if (!rows[0]) return {} as FlatFinalResult<S>;
          return mapReturningRow(
            rows[0] as Record<string, unknown>,
            selects,
          ) as FlatFinalResult<S>;
        },
        sql: () => buildDebugSql(sqb, adapter),
      };
      return finalizer;
    },
    go: async () => {
      const row = await adapter.execute(sqb);
      if (!row[0]) return {} as TModel['~shape'];
      return mapRow(ir, row[0] as Record<string, unknown>) as TModel['~shape'];
    },
    sql: () => buildDebugSql(sqb, adapter),
  });

  return _finalize();
}

/**
 * SQL-превью для batch create: собирает одноразовый sqb по ПЕРВОЙ строке
 * (батч уходит одним multi-row statement) и зеркалит conflict-настройки.
 * `selects` — проекция returning, если она задана.
 */
function buildManyDebugSql(
  baseSqb: KadmiumSqb,
  adapter: SqlAdapter,
  firstRow: Record<string, unknown> | undefined,
  selects: AnySelectableField[] | null,
  rowCount: number,
): string {
  const sqb = new (baseSqb.constructor as new () => KadmiumSqb)();
  sqb.operation = 'upsert';
  sqb.upsertData = firstRow ?? {};
  sqb.tableContext = new Map(baseSqb.tableContext);
  sqb.conflictTarget = baseSqb.conflictTarget
    ? [...baseSqb.conflictTarget]
    : null;
  sqb.upsertSetData = baseSqb.upsertSetData
    ? { ...baseSqb.upsertSetData }
    : null;
  sqb.doNothing = baseSqb.doNothing;
  sqb.selects = selects;
  const sql = buildDebugSql(sqb, adapter);
  // Батч уходит одним multi-row statement, но превью рендерит только первую
  // строку. Без маркера текст читался бы как одиночный INSERT — при N > 1
  // это вводит в заблуждение. Для одной строки маркер не нужен.
  return rowCount > 1 ? `-- preview: first of ${rowCount} rows\n${sql}` : sql;
}

// ── Multi-row create finalizer ──

export function buildCreateManyFinalizer<TModel extends Model>(
  baseSqb: KadmiumSqb,
  adapter: SqlAdapter,
  ir: ModelIR,
  mappedRows: Record<string, unknown>[],
  options?: CreateManyOptions,
): CreateManyFinalizer<TModel> {
  let returningSelects: AnySelectableField[] | null = null;

  const _finalize = <
    S extends readonly AnySelectable[],
  >(): CreateManyFinalizer<TModel> => ({
    ...buildConflictSteps<TModel, CreateManyFinalizer<TModel>>(
      baseSqb,
      ir,
      _finalize,
    ),
    returning: (fn) => {
      returningSelects = applyReturning<TModel>(baseSqb, ir, fn);
      return {
        go: async (): Promise<FlatFinalResult<S>[]> => {
          const rows = await adapter.createMany(ir.collection, mappedRows, {
            transaction: options?.transaction,
            conflictTarget: baseSqb.conflictTarget ?? undefined,
            doNothing: baseSqb.doNothing,
            setData: baseSqb.upsertSetData ?? undefined,
            returning: returningSelects,
          });
          const sel = returningSelects as AnySelectableField[];
          return rows.map((r) =>
            mapReturningRow(r, sel),
          ) as FlatFinalResult<S>[];
        },
        sql: () =>
          buildManyDebugSql(
            baseSqb,
            adapter,
            mappedRows[0],
            returningSelects,
            mappedRows.length,
          ),
      };
    },
    go: async () => {
      const rows = await adapter.createMany(ir.collection, mappedRows, {
        transaction: options?.transaction,
        conflictTarget: baseSqb.conflictTarget ?? undefined,
        doNothing: baseSqb.doNothing,
        setData: baseSqb.upsertSetData ?? undefined,
      });
      return rows.map((r) => mapRow(ir, r)) as TModel['~shape'][];
    },
    sql: () =>
      buildManyDebugSql(
        baseSqb,
        adapter,
        mappedRows[0],
        null,
        mappedRows.length,
      ),
  });

  baseSqb.operation = 'upsert';
  baseSqb.upsertData = mappedRows[0] ?? {};

  return _finalize();
}
