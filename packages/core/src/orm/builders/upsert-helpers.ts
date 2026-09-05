import type { KadmiumSqb } from '../sqb';
import type { ModelIR } from '../../ir/index';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { SelectableField } from '../ast/selectable';
import type { SelectProxy } from '../types/proxy';
import { createSelectProxy } from './query-proxies';

// ── Types ──

type Model = { ['~shape']: Record<string, unknown> };

export interface CreateFinalizer<TModel extends Model> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => CreateFinalizer<TModel>;
  doNothing: () => CreateFinalizer<TModel>;
  go: () => Promise<TModel['~shape']>;
  sql: () => string;
}

export interface CreateManyFinalizer<TModel extends Model> {
  onConflict: (
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ) => CreateManyFinalizer<TModel>;
  doNothing: () => CreateManyFinalizer<TModel>;
  go: () => Promise<TModel['~shape'][]>;
  sql: () => string;
}

export interface CreateManyOptions {
  transaction?: boolean;
}

// ── Helpers ──

function mapRow(
  ir: ModelIR,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [prop, f] of Object.entries(ir.fields)) {
    const col = f.alias ?? prop;
    if (row[col] !== undefined) out[prop] = row[col];
  }
  return out;
}

function extractFieldNames(
  ir: ModelIR,
  fn: (t: SelectProxy<any>) => readonly SelectableField[],
): string[] {
  const proxy = createSelectProxy('__upsert', ir);
  const fields = fn(proxy);
  return fields.map(
    (f) => ir.fields[f.fieldName]?.alias ?? f.fieldName,
  );
}

function _buildSql(sqb: KadmiumSqb, adapter: SqlAdapter): string {
  const { text, values } = adapter.toSql(sqb);
  return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
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
      sqb.conflictTarget = extractFieldNames(ir, fn as any);
      return _finalize();
    },
    doNothing: () => {
      sqb.doNothing = true;
      return _finalize();
    },
    go: async () => {
      const row = await adapter.execute(sqb);
      if (!row[0]) return {} as TModel['~shape'];
      return mapRow(ir, row[0] as Record<string, unknown>) as TModel['~shape'];
    },
    sql: () => _buildSql(sqb, adapter),
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
      baseSqb.conflictTarget = extractFieldNames(ir, fn as any);
      return _finalize();
    },
    doNothing: () => {
      baseSqb.doNothing = true;
      return _finalize();
    },
    go: async () => {
      if (!baseSqb.conflictTarget?.length) {
        const rows = await adapter.createMany(ir.collection, mappedRows, options);
        return rows.map((r) => mapRow(ir, r)) as TModel['~shape'][];
      }
      // With ON CONFLICT: each row needs its own INSERT
      const results: TModel['~shape'][] = [];
      for (const row of mappedRows) {
        const sqb = new (baseSqb.constructor as any)();
        sqb.operation = 'upsert';
        sqb.upsertData = row;
        sqb.tableContext = new Map(baseSqb.tableContext);
        sqb.conflictTarget = [...baseSqb.conflictTarget!];
        sqb.doNothing = baseSqb.doNothing;
        const result = await adapter.execute(sqb);
        if (result[0]) results.push(mapRow(ir, result[0] as Record<string, unknown>) as TModel['~shape']);
      }
      return results;
    },
    sql: () => {
      // Show SQL for first row as preview
      const sqb = new (baseSqb.constructor as any)();
      sqb.operation = 'upsert';
      sqb.upsertData = mappedRows[0];
      sqb.tableContext = new Map(baseSqb.tableContext);
      sqb.conflictTarget = baseSqb.conflictTarget
        ? [...baseSqb.conflictTarget]
        : null;
      sqb.doNothing = baseSqb.doNothing;
      return _buildSql(sqb, adapter);
    },
  });

  baseSqb.operation = 'upsert';
  baseSqb.upsertData = mappedRows[0] ?? {};

  return _finalize();
}
