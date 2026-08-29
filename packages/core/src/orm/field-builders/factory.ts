import { KadmiumSqb } from '../sqb';
import type { FieldIR } from '../../ir/index';
import type { WhereCondition } from '../ast/where';
import { BaseFilter } from './base-filter';
import {
  StringFilter,
  NumberFilter,
  BooleanFilter,
  DateFilter,
} from './filters';

export type NullableFilter = BaseFilter & {
  readonly null: WhereCondition;
  readonly notNull: WhereCondition;
};

export function createFilter(
  sqb: KadmiumSqb,
  field: string,
  alias: string,
  ir: FieldIR,
): BaseFilter | NullableFilter {
  const column = ir.alias ?? field;
  const filter = createBaseFilter(sqb, field, alias, ir, column);
  if (ir.nullable) {
    return Object.assign(filter, {
      get null(): WhereCondition {
        return { alias, field, column, op: 'IS NULL' as const, value: null };
      },
      get notNull(): WhereCondition {
        return {
          alias,
          field,
          column,
          op: 'IS NOT NULL' as const,
          value: null,
        };
      },
    });
  }
  return filter;
}

function createBaseFilter(
  sqb: KadmiumSqb,
  field: string,
  alias: string,
  ir: FieldIR,
  column: string,
): BaseFilter {
  switch (ir.type) {
    case 'string':
      return new StringFilter(sqb, field, alias, column);
    case 'number':
    case 'primary':
    case 'bigint':
    case 'int':
    case 'decimal':
    case 'float':
    case 'numeric':
    case 'ref': // FK-колонка: сравнение по id целевой модели
      return new NumberFilter(sqb, field, alias, column);
    case 'boolean':
      return new BooleanFilter(sqb, field, alias, column);
    case 'datetime':
    case 'date':
    case 'time':
      return new DateFilter(sqb, field, alias, column);
    default:
      return new BaseFilter(sqb, field, alias, column);
  }
}
