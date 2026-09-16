import type {
  CompiledQuery,
  HoleRef,
  SlotDefinition,
} from '@karkardmitry/kadmium-sql-types';
import { KadmiumSqb } from './sqb';
import { isHoleRef, SlotMarker } from './slot';

export type SqlPart =
  | string
  | number
  | boolean
  | Date
  | null
  | SlotMarker
  | SqlFragment
  | CompiledQuery<Record<string, unknown>, unknown>
  | SqlFieldRef;

/** Объект, который рендерится в идентификатор колонки: SelectableField, BaseFilter. */
export interface SqlFieldRef {
  getIdentifierForSql(): string;
}

export function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...parts: SqlPart[]
): SqlFragment<T> {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === undefined)
      throw new Error(
        `sql: undefined at position ${i}. Use null for SQL NULL or slot() for a named parameter.`,
      );
  }
  return new SqlFragment<T>(strings, parts);
}

export class SqlFragment<T = unknown> {
  readonly kind = 'sql' as const;

  constructor(
    readonly segments: readonly string[],
    readonly parts: readonly SqlPart[],
  ) {}

  as<A extends string>(alias: A): SqlSelectable<T, A> {
    return new SqlSelectable<T, A>(this, alias);
  }

  get asc(): SqlOrder<'asc'> {
    return new SqlOrder(this, 'asc');
  }

  get desc(): SqlOrder<'desc'> {
    return new SqlOrder(this, 'desc');
  }

  compile<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(): CompiledQuery<T, unknown> {
    const values: unknown[] = [];
    const slotOrder: SlotDefinition[] = [];
    const paramIndex = { p: 1, slotOrder };
    const text = renderFragment(this.segments, this.parts, values, paramIndex);
    return {
      text,
      values: values as (unknown | HoleRef)[],
      slotOrder,
      single: false,
      sqb: new KadmiumSqb() as unknown as import('@karkardmitry/kadmium-sql-types').ReadonlySqb,
    } as unknown as CompiledQuery<T, unknown>;
  }

  toString(): string {
    return renderDebug(this.segments, this.parts);
  }
}

export class SqlSelectable<T, A extends string> {
  readonly kind = 'sql-item' as const;
  readonly alias: A;
  /** Текст фрагмента с локальными $1..$N (сдвигается на текущий paramIndex адаптера). */
  readonly text: string;
  readonly values: readonly unknown[];
  readonly slotOrder: readonly SlotDefinition[];

  constructor(fragment: SqlFragment<T>, alias: A) {
    const values: unknown[] = [];
    const slotOrder: SlotDefinition[] = [];
    const text = renderFragment(fragment.segments, fragment.parts, values, {
      p: 1,
      slotOrder,
    });
    this.alias = alias;
    this.text = text;
    this.values = values;
    this.slotOrder = slotOrder;
  }
}

export class SqlOrder<D extends 'asc' | 'desc'> {
  readonly kind = 'sql-order' as const;

  constructor(
    readonly fragment: SqlFragment<unknown>,
    readonly direction: D,
  ) {}
}

export function isSqlFragment(v: unknown): v is SqlFragment {
  return (
    !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'sql'
  );
}

export function isCompiledQuery(
  v: unknown,
): v is CompiledQuery<Record<string, unknown>, unknown> {
  return (
    !!v &&
    typeof v === 'object' &&
    'text' in v &&
    'values' in v &&
    'slotOrder' in v &&
    'single' in v &&
    'sqb' in v
  );
}

function renderFragment(
  segments: readonly string[],
  parts: readonly SqlPart[],
  values: unknown[],
  paramIndex: { p: number; slotOrder: SlotDefinition[] },
): string {
  let text = '';
  for (let i = 0; i < segments.length; i++) {
    text += segments[i];
    if (i < parts.length) {
      text += renderPart(parts[i], values, paramIndex);
    }
  }
  return text;
}

function renderPart(
  part: SqlPart,
  values: unknown[],
  paramIndex: { p: number; slotOrder: SlotDefinition[] },
): string {
  if (part === null) {
    values.push(null);
    return `$${paramIndex.p++}`;
  }

  if (typeof part === 'object' && isHoleRef(part)) {
    values.push(part);
    const idx = paramIndex.p++;
    if (!paramIndex.slotOrder.some((s) => s.name === part.slotName)) {
      paramIndex.slotOrder.push({ name: part.slotName, index: idx });
    }
    return `$${idx}`;
  }

  if (typeof part === 'object' && isSqlFragment(part)) {
    return renderFragment(part.segments, part.parts, values, paramIndex);
  }

  if (typeof part === 'object' && isCompiledQuery(part)) {
    return inlineCompiled(part, values, paramIndex);
  }

  if (
    typeof part === 'object' &&
    part !== null &&
    'getIdentifierForSql' in part
  ) {
    return (part as SqlFieldRef).getIdentifierForSql();
  }

  values.push(part);
  return `$${paramIndex.p++}`;
}

function inlineCompiled(
  compiled: CompiledQuery<Record<string, unknown>, unknown>,
  values: unknown[],
  paramIndex: { p: number; slotOrder: SlotDefinition[] },
): string {
  const start = paramIndex.p;
  const text = shiftSql(compiled.text, start - 1);
  for (const v of compiled.values) {
    values.push(v);
    paramIndex.p++;
  }
  for (const s of compiled.slotOrder ?? []) {
    if (!paramIndex.slotOrder.some((os) => os.name === s.name)) {
      paramIndex.slotOrder.push({
        name: s.name,
        index: start - 1 + s.index,
      });
    }
  }
  return text;
}

export function shiftSql(text: string, offset: number): string {
  if (offset === 0) return text;
  return text.replace(/\$(\d+)/g, (_, num) => `$${Number(num) + offset}`);
}

function renderDebug(
  segments: readonly string[],
  parts: readonly SqlPart[],
): string {
  let out = '';
  for (let i = 0; i < segments.length; i++) {
    out += segments[i];
    if (i < parts.length) out += debugPart(parts[i]);
  }
  return out;
}

function debugPart(part: SqlPart): string {
  if (part === null) return 'null';
  if (typeof part === 'object' && isSqlFragment(part))
    return renderDebug(part.segments, part.parts);
  if (typeof part === 'object' && isCompiledQuery(part))
    return part.text + ` [${(part.values ?? []).join(', ')}]`;
  if (typeof part === 'object' && 'getIdentifierForSql' in part)
    return (part as SqlFieldRef).getIdentifierForSql();
  return String(part);
}
