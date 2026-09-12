/**
 * AggregateField — агрегатная функция в SELECT (COUNT, SUM, AVG, MIN, MAX).
 * Несёт phantom-тип TResult для type-level инференса результата.
 * Данные только: SQL-рендером занимается адаптер (структурный паттерн WhereCondition).
 */
import { FuncField } from './func-field';

export class AggregateField<TResult = unknown> extends FuncField<TResult> {
  public readonly kind = 'aggregate' as const;
  declare readonly func: 'count' | 'sum' | 'avg' | 'min' | 'max';

  constructor(
    func: 'count' | 'sum' | 'avg' | 'min' | 'max',
    /** '*'' для COUNT(*) или SelectableField для SUM(field) */
    field: { tableAlias: string; fieldName: string } | '*',
  ) {
    super(func, field);
  }

  /** Переименовать агрегат в SELECT (возвращает новый инстанс) */
  as<A extends string>(alias: A): AggregateField<TResult> & { alias: A } {
    const copy = new AggregateField<TResult>(this.func, this.field);
    copy.alias = alias;
    return copy as AggregateField<TResult> & { alias: A };
  }
}
