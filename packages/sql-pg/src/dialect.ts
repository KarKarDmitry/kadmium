/**
 * PostgreSQL-реализация `Dialect`.
 *
 * Тонкая обёртка над функциями `diff/types.ts`, а не перенос логики: пока
 * `computeDiff()` живёт в этом пакете, обёртка выглядит формальностью. Она
 * нужна, чтобы `core` зависел от метода `Dialect`, а не от `pgType` —
 * иначе переезд движка в core потребовал бы правки каждого вызова.
 */

import type {
  Dialect,
  IrField,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';
import {
  defaultsEqual,
  normalizePgType,
  pgType,
  renderDefault,
} from './diff/types';

export const pgDialect: Dialect = {
  typeName(field: IrField, irs: readonly IrModel[]): string {
    return pgType(field, irs);
  },

  normalizeTypeName(name: string): string {
    return normalizePgType(name);
  },

  renderDefault(field: IrField): string | null {
    return renderDefault(field);
  },

  defaultsEqual(
    field: IrField,
    expected: string | null,
    actual: string | null,
  ): boolean {
    return defaultsEqual(field, expected, actual);
  },
};
