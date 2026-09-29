import type { SlotDefinition } from '@karkardmitry/kadmium-sql-types';

/** GROUP BY по обычной колонке: "alias"."column". Алиас пуст — mainTableAlias. */
export type GroupByColumnStep = {
  readonly kind: 'group-by-column';
  readonly tableAlias?: string;
  readonly column: string;
};

/** GROUP BY по sql-фрагменту: скомпилированный текст + локальные $N. */
export type GroupByFragmentStep = {
  readonly kind: 'group-by-fragment';
  readonly text: string;
  readonly values: readonly unknown[];
  readonly slotOrder: readonly SlotDefinition[];
};

export type GroupByStep = GroupByColumnStep | GroupByFragmentStep;
