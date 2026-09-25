import type { CompiledQuery } from '@karkardmitry/kadmium-sql-types';
import type { AnyCompiledQuery } from './types/phantom';
import { isHoleRef } from './slot';

/** Заполненный компилированный запрос: маркеры слотов заменены значениями. */
export type FilledCompiled = {
  readonly text: string;
  readonly params: unknown[];
};

export type ExtractSlots<C> =
  C extends CompiledQuery<infer S, unknown> ? S : never;
export type ExtractResult<C> =
  C extends CompiledQuery<Record<string, unknown>, infer R> ? R : never;

/** Раннер компилированного запроса: fill(input).go() (План 3, B2). */
export type CompiledRunner<C extends AnyCompiledQuery> = {
  fill(input: ExtractSlots<C>): {
    /** Выполнить через adapter.raw + adapter.reshape (ноль рендера). */
    go(): Promise<ExtractResult<C>>;
    /** SQL-preview: "SQL: …\nVALUES: […]". */
    sql(): string;
  };
};

/** Раннер raw-запроса: orm.raw(...).go() — терминал без reshape (всегда массив). */
export type RawRunner<TResult> = {
  /** Выполнить через adapter.raw (типы строк задаёт вызывающий). */
  go(): Promise<TResult[]>;
  /** SQL-preview: "SQL: …\nVALUES: […]". */
  sql(): string;
};

/**
 * Заменить маркеры слотов значениями (План 3, B2).
 * Валидация: лишний/недостающий ключ → throw с именами. Раскладка по slotOrder
 * (индекс первого вхождения), маркер заменяется во всех вхождениях (dedup по имени).
 */
export function fillCompiled(
  compiled: Pick<CompiledQuery, 'text' | 'values' | 'slotOrder'>,
  input: Record<string, unknown>,
): FilledCompiled {
  const declared = new Set(compiled.slotOrder.map((s) => s.name));
  const given = new Set(Object.keys(input));
  const missing = [...declared].filter((n) => !given.has(n));
  const extra = [...given].filter((n) => !declared.has(n));
  if (missing.length > 0)
    throw new Error(`Missing slot value(s): ${missing.join(', ')}`);
  if (extra.length > 0)
    throw new Error(`Unknown slot key(s): ${extra.join(', ')}`);
  const params = compiled.values.map((v) =>
    isHoleRef(v) ? input[v.slotName] : v,
  );
  return { text: compiled.text, params };
}
