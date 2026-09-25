import type { KadmiumSqb } from '../sqb';
import type { ModelIR } from '../../ir/index';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { SelectableField } from '../ast/selectable';
import type { SelectProxy, FilterProxy } from '../types/proxy';
import { createSelectProxy, createFilterProxy } from './query-proxies';
import { toSqlValue } from '../sql-fragment';
import { buildDebugSql, mapRow } from './utils';

// ── Types ──

type Model = { ['~shape']: Record<string, unknown> };

/** Данные DML: объект значений или коллбэк с типизированным proxy (F). */
type DmlData<TModel extends Model> =
  | Record<string, unknown>
  | ((p: FilterProxy<TModel>) => Record<string, unknown>);

export interface CreateFinalizer<TModel extends Model> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => CreateFinalizer<TModel>;
  doNothing: () => CreateFinalizer<TModel>;
  /** DO UPDATE SET-выражения для ON CONFLICT (F): обычные значения или sql-фрагменты. */
  set: (data: DmlData<TModel>) => CreateFinalizer<TModel>;
  go: () => Promise<TModel['~shape']>;
  sql: () => string;
}

export interface CreateManyFinalizer<TModel extends Model> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => CreateManyFinalizer<TModel>;
  doNothing: () => CreateManyFinalizer<TModel>;
  /** DO UPDATE SET-выражения для ON CONFLICT (F): обычные значения или sql-фрагменты. */
  set: (data: DmlData<TModel>) => CreateManyFinalizer<TModel>;
  go: () => Promise<TModel['~shape'][]>;
  sql: () => string;
}

export interface CreateManyOptions {
  transaction?: boolean;
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

// ── Single row create finalizer ──

export function buildCreateFinalizer<TModel extends Model>(
  sqb: KadmiumSqb,
  adapter: SqlAdapter,
  ir: ModelIR,
  mapped: Record<string, unknown>,
): CreateFinalizer<TModel> {
  sqb.operation = 'upsert';
  sqb.upsertData = mapped;

  const _finalize = (): CreateFinalizer<TModel> => ({
    onConflict: (fn) => {
      sqb.conflictTarget = extractFieldNames(ir, fn);
      return _finalize();
    },
    doNothing: () => {
      sqb.doNothing = true;
      return _finalize();
    },
    set: (data) => {
      applySet<TModel>(sqb, ir, data);
      return _finalize();
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

// ── Multi-row create finalizer ──

export function buildCreateManyFinalizer<TModel extends Model>(
  baseSqb: KadmiumSqb,
  adapter: SqlAdapter,
  ir: ModelIR,
  mappedRows: Record<string, unknown>[],
  options?: CreateManyOptions,
): CreateManyFinalizer<TModel> {
  const _finalize = (): CreateManyFinalizer<TModel> => ({
    onConflict: (fn) => {
      baseSqb.conflictTarget = extractFieldNames(ir, fn);
      return _finalize();
    },
    doNothing: () => {
      baseSqb.doNothing = true;
      return _finalize();
    },
    set: (data) => {
      applySet<TModel>(baseSqb, ir, data);
      return _finalize();
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
    sql: () => {
      // Preview for the first row (batch upsert issues a single multi-row statement)
      const sqb = new (baseSqb.constructor as new () => KadmiumSqb)();
      sqb.operation = 'upsert';
      sqb.upsertData = mappedRows[0];
      sqb.tableContext = new Map(baseSqb.tableContext);
      sqb.conflictTarget = baseSqb.conflictTarget
        ? [...baseSqb.conflictTarget]
        : null;
      sqb.upsertSetData = baseSqb.upsertSetData
        ? { ...baseSqb.upsertSetData }
        : null;
      sqb.doNothing = baseSqb.doNothing;
      return buildDebugSql(sqb, adapter);
    },
  });

  baseSqb.operation = 'upsert';
  baseSqb.upsertData = mappedRows[0] ?? {};

  return _finalize();
}
