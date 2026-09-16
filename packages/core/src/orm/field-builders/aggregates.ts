import { AggregateField } from '../ast/aggregate';
import type { AnySelectableField } from '../types/phantom';
import type { GetFieldType } from '../types/proxy';

type AggregateFunction<T> = (
  field: AnySelectableField | '*',
) => AggregateField<T>;

export type AggregateFunctions = {
  count: AggregateFunction<number>;
  sum: AggregateFunction<number | null>;
  avg: AggregateFunction<number | null>;
  min: <F extends AnySelectableField>(
    field: F,
  ) => AggregateField<GetFieldType<F> | null>;
  max: <F extends AnySelectableField>(
    field: F,
  ) => AggregateField<GetFieldType<F> | null>;
};

export const aggregates: AggregateFunctions = {
  count: (field) => new AggregateField<number>('count', field),
  sum: (field) => new AggregateField<number | null>('sum', field),
  avg: (field) => new AggregateField<number | null>('avg', field),
  min: <F extends AnySelectableField>(field: F) =>
    new AggregateField<GetFieldType<F> | null>('min', field),
  max: <F extends AnySelectableField>(field: F) =>
    new AggregateField<GetFieldType<F> | null>('max', field),
};
