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
  const filter = createBaseFilter(sqb, field, alias, ir);
  if (ir.nullable) {
    return Object.assign(filter, {
      get null(): WhereCondition {
        return { alias, field, op: 'IS NULL' as const, value: null };
      },
      get notNull(): WhereCondition {
        return { alias, field, op: 'IS NOT NULL' as const, value: null };
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
): BaseFilter {
  switch (ir.type) {
    case 'string':
      return new StringFilter(sqb, field, alias);
    case 'number':
    case 'primary':
    case 'bigint':
    case 'int':
    case 'decimal':
    case 'float':
    case 'numeric':
    case 'ref': // FK-колонка: сравнение по id целевой модели
      return new NumberFilter(sqb, field, alias);
    case 'boolean':
      return new BooleanFilter(sqb, field, alias);
    case 'datetime':
    case 'date':
    case 'time':
      return new DateFilter(sqb, field, alias);
    default:
      return new BaseFilter(sqb, field, alias);
  }
}
