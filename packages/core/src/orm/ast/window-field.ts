/**
 * WindowField — оконная функция в SELECT.
 * kind='window' отличает её от агрегатов (HAVING/groupBy по нему не работает),
 * `aggregate=true` — окно над агрегатом (сумма/минимум по окну).
 * Данные только: SQL-рендером занимается адаптер.
 */
import { FuncField } from './func-field';
import {
  WindowSpec,
  assertFrameBound,
  type FrameBound,
  type WindowPartitionField,
} from './window-spec';
import type { OrderDirection } from '../types/proxy';

export const WINDOW_AGGREGATE_NAMES = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
] as const;

export type WindowFuncName =
  | 'row_number'
  | 'rank'
  | 'dense_rank'
  | 'percent_rank'
  | 'cume_dist'
  | 'ntile'
  | 'lag'
  | 'lead'
  | 'first_value'
  | 'last_value'
  | 'nth_value'
  | (typeof WINDOW_AGGREGATE_NAMES)[number];

/** Аргумент-параметр оконной функции (ntile(n), lag offset/default, nth_value(n)) */
export type WindowArg = number | string | boolean | null;

/** Ранги требуют ORDER BY внутри окна (PG: иначе ошибка выполнения). */
const REQUIRES_ORDER_BY = new Set<WindowFuncName>([
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
]);

export class WindowField<TResult = unknown> extends FuncField<TResult> {
  public readonly kind = 'window' as const;
  declare readonly func: WindowFuncName;
  /** Windowed aggregate: func — имя агрегата, field — его аргумент или '*' */
  readonly aggregate: boolean;
  /** Аргументы-параметры в том же порядке, что в SQL */
  readonly args: readonly WindowArg[];
  /** Спецификация окна (всегда задана; возможен пустой `OVER ()`) */
  public over: WindowSpec;

  constructor(
    func: WindowFuncName,
    field:
      | { tableAlias: string; fieldName: string; column?: string }
      | '*'
      | null = null,
    args: readonly WindowArg[] = [],
    aggregate = false,
    over: WindowSpec = new WindowSpec(),
  ) {
    super(func, field);
    this.args = args;
    this.aggregate = aggregate;
    this.over = over;
  }

  partitionBy(...fields: readonly WindowPartitionField[]): this {
    this.over = new WindowSpec(
      [...this.over.partitionBy, ...fields],
      this.over.orderBy,
      this.over.frame,
    );
    return this;
  }

  orderBy(...orders: readonly OrderDirection[]): this {
    this.over = new WindowSpec(
      this.over.partitionBy,
      [...this.over.orderBy, ...orders],
      this.over.frame,
    );
    return this;
  }

  rowsBetween(start: FrameBound, end: FrameBound): this {
    assertFrameBound(start, 'start');
    assertFrameBound(end, 'end');
    this.over = new WindowSpec(this.over.partitionBy, this.over.orderBy, [
      start,
      end,
    ]);
    return this;
  }

  /** Непротиворечивость окна: rank-семейство требует ORDER BY. */
  validate(): void {
    if (REQUIRES_ORDER_BY.has(this.func) && this.over.orderBy.length === 0) {
      throw new Error(
        `${this.func.toUpperCase()}() requires ORDER BY in the window`,
      );
    }
    if (this.aggregate && this.field === null) {
      throw new Error('Windowed aggregate requires a field or *');
    }
  }

  as<A extends string>(alias: A): WindowField<TResult> & { alias: A } {
    const copy = new WindowField(
      this.func,
      this.field,
      this.args,
      this.aggregate,
      this.over,
    );
    copy.alias = alias;
    return copy as WindowField<TResult> & { alias: A };
  }
}
