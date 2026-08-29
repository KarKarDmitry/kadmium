import { AggregateField } from '../ast/aggregate';
import type { SelectableField } from '../ast/selectable';

type AggregateFunction<T> = (
  field: SelectableField<any, any, any> | '*',
) => AggregateField<T>;

export type AggregateFunctions = {
  count: AggregateFunction<number>;
  sum: AggregateFunction<number | null>;
  avg: AggregateFunction<number | null>;
  min: <F extends SelectableField<any, any, any>>(
    field: F,
  ) => AggregateField<GetFieldType<F> | null>;
  max: <F extends SelectableField<any, any, any>>(
    field: F,
  ) => AggregateField<GetFieldType<F> | null>;
};

type GetFieldType<F> =
  F extends SelectableField<infer T, any, any> ? T : unknown;

export const aggregates: AggregateFunctions = {
  count: (field) => new AggregateField<number>('count', field),
  sum: (field) => new AggregateField<number | null>('sum', field),
  avg: (field) => new AggregateField<number | null>('avg', field),
  min: <F extends SelectableField<any, any, any>>(field: F) =>
    new AggregateField<GetFieldType<F> | null>('min', field),
  max: <F extends SelectableField<any, any, any>>(field: F) =>
    new AggregateField<GetFieldType<F> | null>('max', field),
};
