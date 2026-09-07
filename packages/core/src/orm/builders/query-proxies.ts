/**
 * Shared proxy factories for SingleQueryBuilder and Relation.
 *
 * Both classes create identical Proxy objects for filter/select/order
 * access — the only difference is the source of `alias`, `ir`, and `sqb`.
 * These helpers eliminate the duplication.
 */

import { SelectableField } from '../ast/selectable';
import { createFilter } from '../field-builders/factory';
import type { ModelIR } from '../../ir/index';
import type { KadmiumSqb } from '../sqb';
import type { FilterProxy, SelectProxy, OrderProxy } from '../types/proxy';

type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

export function createFilterProxy<TModel extends Model>(
  alias: string,
  ir: ModelIR,
  sqb: KadmiumSqb,
): FilterProxy<TModel> {
  return new Proxy({} as FilterProxy<TModel>, {
    get: (_, field: string) => {
      const fieldIr = ir.fields[field];
      if (!fieldIr) throw new Error(`Field "${field}" not found in ${ir.name}`);
      return createFilter(sqb, field, alias, fieldIr);
    },
  });
}

export function createSelectProxy<TModel extends Model>(
  alias: string,
  ir: ModelIR,
): SelectProxy<TModel> {
  return new Proxy({} as SelectProxy<TModel>, {
    get: (_, field: string) =>
      new SelectableField(
        alias,
        field,
        undefined,
        undefined,
        ir.fields[field]?.alias,
      ),
  });
}

export function createOrderProxy<TModel extends Model>(
  alias: string,
  ir: ModelIR,
): OrderProxy<TModel> {
  return new Proxy({} as OrderProxy<TModel>, {
    get: (_, field: string) => ({
      tableAlias: alias,
      fieldName: field as string,
      column: ir.fields[field]?.alias,
    }),
  });
}
