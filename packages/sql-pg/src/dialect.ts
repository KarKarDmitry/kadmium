/**
 * PostgreSQL-реализация `Dialect`.
 *
 * Тонкая обёртка над функциями `diff/types.ts` и `diff/render.ts`, а не перенос
 * логики: она нужна, чтобы `core` зависел от метода `Dialect`, а не от
 * `pgType`/`renderSql` — иначе движок диффа и CLI тянули бы в себя
 * реализацию адаптера, и установка core из npm падала с MODULE_NOT_FOUND.
 */

import type {
  Dialect,
  DiffResult,
  IrField,
  IrModel,
} from '@karkardmitry/kadmium-sql-types';
import {
  defaultsEqual,
  normalizePgType,
  pgType,
  renderDefault,
} from './diff/types';
import { renderSql } from './diff/render';

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

  renderSql(diff: DiffResult): string {
    return renderSql(diff);
  },
};
