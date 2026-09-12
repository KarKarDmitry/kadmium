/**
 * AggregateField — агрегатная функция в SELECT (COUNT, SUM, AVG, MIN, MAX).
 * Несёт phantom-тип TResult для type-level инференса результата.
 * Данные только: SQL-рендером занимается адаптер (структурный паттерн WhereCondition).
 */
import { FuncField } from './func-field';
import { WindowField } from './window-field';
import { WindowSpec } from './window-spec';

export class AggregateField<TResult = unknown> extends FuncField<TResult> {
  public readonly kind = 'aggregate' as const;
  declare readonly func: 'count' | 'sum' | 'avg' | 'min' | 'max';
  /** Агрегат всегда имеет аргумент: поле или '*' — никогда null. */
  declare readonly field:
    { tableAlias: string; fieldName: string; column?: string } | '*';

  constructor(
    func: 'count' | 'sum' | 'avg' | 'min' | 'max',
    /** '*'' для COUNT(*) или SelectableField для SUM(field) */
    field: { tableAlias: string; fieldName: string; column?: string } | '*',
  ) {
    super(func, field);
  }

  /**
   * Превратить агрегат в оконный: `agg.sum(t.salary).over()` → `SUM(salary) OVER (...)`.
   * Возвращает WindowField (kind='window') с окном over; можно чинить через
   * `.partitionBy/.orderBy/.rowsBetween`.
   */
  over(spec: WindowSpec = new WindowSpec()): WindowField<TResult> {
    return new WindowField<TResult>(this.func, this.field, [], true, spec);
  }

  /** Переименовать агрегат в SELECT (возвращает новый инстанс) */
  as<A extends string>(alias: A): AggregateField<TResult> & { alias: A } {
    const copy = new AggregateField<TResult>(this.func, this.field);
    copy.alias = alias;
    return copy as AggregateField<TResult> & { alias: A };
  }
}
