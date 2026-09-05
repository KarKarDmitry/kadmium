/**
 * Shared proxy factories for SingleQueryBuilder and Relation.
 *
 * Both classes create identical Proxy objects for filter/select/order/relation
 * access — the only difference is the source of `alias`, `ir`, `sqb`, and
 * `irLookup`. These helpers eliminate the duplication.
 */

import { SelectableField } from '../ast/selectable';
import { createFilter } from '../field-builders/factory';
import type { IRelationBuilder } from '../field-builders/relation';
import type { ModelIR } from '../../ir/index';
import { toSnakeCase } from '../../ir/index';
import type { KadmiumSqb } from '../sqb';
import type {
  FilterProxy,
  SelectProxy,
  OrderProxy,
  RelationProxy,
} from '../types/proxy';

/** Factory that creates a Relation-like include builder. */
export type RelationFactory = new (
  sqb: KadmiumSqb,
  name: string,
  targetIr: ModelIR,
  fieldIr: ModelIR['fields'][string] | undefined,
  irLookup?: (name: string) => ModelIR | undefined,
  parentAlias?: any,
) => IRelationBuilder<any, any, any, any, any>;

type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
};

export function createFilterProxy<TModel extends Model>(
  alias: string,
  ir: ModelIR,
  sqb: KadmiumSqb,
): FilterProxy<TModel> {
  return new Proxy({} as FilterProxy<TModel>, {
    get: (_, field: string) => {
      const fieldIr = ir.fields[field];
      if (!fieldIr)
        throw new Error(`Field "${field}" not found in ${ir.name}`);
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

export function createRelationProxy<TModel extends Model>(
  alias: string,
  ir: ModelIR,
  sqb: KadmiumSqb,
  relationFactory: RelationFactory,
  irLookup?: (name: string) => ModelIR | undefined,
): RelationProxy<TModel> {
  return new Proxy({} as RelationProxy<TModel>, {
    get: (_, name: string) => {
      const fieldIr = ir.fields[name];
      if (!fieldIr || fieldIr.type !== 'ref')
        throw new Error(`Relation "${name}" not found in ${ir.name}`);
      const targetName = fieldIr.sourceModel ?? fieldIr.ref ?? name;
      const targetIr: ModelIR = irLookup?.(targetName) ?? {
        name: targetName,
        collection: toSnakeCase(targetName),
        fields: {},
      };
      return new relationFactory(
        sqb,
        name,
        targetIr,
        fieldIr,
        irLookup,
        alias,
      );
    },
  });
}
