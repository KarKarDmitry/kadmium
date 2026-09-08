/**
 * Shared proxy factories for SingleQueryBuilder and Relation.
 *
 * Both classes create identical Proxy objects for filter/select/order
 * access — the only difference is the source of `alias`, `ir`, and `sqb`.
 * These helpers eliminate the duplication.
 */

import { SelectableField } from '../ast/selectable';
import { createFilter } from '../field-builders/factory';
import { NumberFilter } from '../field-builders/filters';
import type { ModelIR } from '../../ir/index';
import type { KadmiumSqb } from '../sqb';
import type {
  FilterProxy,
  SelectProxy,
  OrderProxy,
  HavingProxy,
} from '../types/proxy';

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

/**
 * createHavingProxy — proxy для HAVING. Ключи — агрегатные алиасы из SELECT;
 * условия рендерятся как `"<alias>" op $n` (без префикса таблицы, т.к. alias='').
 * Несуществующий алиас — ошибка с подсказкой про .as().
 */
export function createHavingProxy<S extends readonly any[]>(
  sqb: KadmiumSqb,
  aliases: Set<string>,
): HavingProxy<S> {
  return new Proxy({} as HavingProxy<S>, {
    get: (_, field: string) => {
      if (!aliases.has(field)) {
        throw new Error(
          `Unknown aggregate alias "${field}" in having(). ` +
            'Aliases come from select()/first() aggregates using .as("<name>").',
        );
      }
      return new NumberFilter(sqb, field, '', field);
    },
  });
}
