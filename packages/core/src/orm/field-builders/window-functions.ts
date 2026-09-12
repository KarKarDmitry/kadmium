/**
 * WindowFunctions — `wf` доступен вторым аргументом select-callback'а:
 * `(t, { wf }) => [wf.rowNumber().over().orderBy(t.id.asc)]`.
 * Данные только: рендером окон занимается адаптер.
 */
import { WindowField, type WindowArg } from '../ast/window-field';
import type { SelectableField } from '../ast/selectable';
import type { GetFieldType } from '../types/proxy';

type NoArgWindow = () => WindowField<number>;
type WithArgWindow = (arg: number) => WindowField<number>;

export type WindowFunctions = {
  rowNumber: NoArgWindow;
  rank: NoArgWindow;
  denseRank: NoArgWindow;
  percentRank: NoArgWindow;
  cumeDist: NoArgWindow;
  ntile: WithArgWindow;
  lag: <F extends SelectableField<any, any, any>>(
    field: F,
    offset?: number,
    defaultValue?: GetFieldType<F> | string | number | boolean | null,
  ) => WindowField<GetFieldType<F> | null>;
  lead: <F extends SelectableField<any, any, any>>(
    field: F,
    offset?: number,
    defaultValue?: GetFieldType<F> | string | number | boolean | null,
  ) => WindowField<GetFieldType<F> | null>;
  firstValue: <F extends SelectableField<any, any, any>>(
    field: F,
  ) => WindowField<GetFieldType<F> | null>;
  lastValue: <F extends SelectableField<any, any, any>>(
    field: F,
  ) => WindowField<GetFieldType<F> | null>;
  nthValue: <F extends SelectableField<any, any, any>>(
    field: F,
    n: number,
  ) => WindowField<GetFieldType<F> | null>;
};

const lagLeadArgs = (
  offset: number | undefined,
  defaultValue?: unknown,
): WindowArg[] => {
  const args: WindowArg[] = [];
  if (offset !== undefined) args.push(offset);
  if (defaultValue !== undefined) args.push(defaultValue as WindowArg);
  return args;
};

export const windowFunctions: WindowFunctions = {
  rowNumber: () => new WindowField<number>('row_number'),
  rank: () => new WindowField<number>('rank'),
  denseRank: () => new WindowField<number>('dense_rank'),
  percentRank: () => new WindowField<number>('percent_rank'),
  cumeDist: () => new WindowField<number>('cume_dist'),
  ntile: (arg) => new WindowField<number>('ntile', null, [arg]),
  lag: <F extends SelectableField<any, any, any>>(
    field: F,
    offset?: number,
    defaultValue?: GetFieldType<F> | string | number | boolean | null,
  ) =>
    new WindowField<GetFieldType<F> | null>(
      'lag',
      field,
      lagLeadArgs(offset, defaultValue),
    ),
  lead: <F extends SelectableField<any, any, any>>(
    field: F,
    offset?: number,
    defaultValue?: GetFieldType<F> | string | number | boolean | null,
  ) =>
    new WindowField<GetFieldType<F> | null>(
      'lead',
      field,
      lagLeadArgs(offset, defaultValue),
    ),
  firstValue: <F extends SelectableField<any, any, any>>(field: F) =>
    new WindowField<GetFieldType<F> | null>('first_value', field),
  lastValue: <F extends SelectableField<any, any, any>>(field: F) =>
    new WindowField<GetFieldType<F> | null>('last_value', field),
  nthValue: <F extends SelectableField<any, any, any>>(field: F, n: number) =>
    new WindowField<GetFieldType<F> | null>('nth_value', field, [n]),
};
