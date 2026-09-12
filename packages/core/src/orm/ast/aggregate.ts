/**
 * AggregateField — агрегатная функция в SELECT (COUNT, SUM, AVG, MIN, MAX).
 * Несёт phantom-тип TResult для type-level инференса результата.
 * Данные только: SQL-рендером занимается адаптер (структурный паттерн WhereCondition).
 */
export class AggregateField<TResult = unknown> {
  public readonly kind = 'aggregate' as const;
  public alias: string = '';
  declare readonly aggregateType: TResult;

  constructor(
    public readonly func: 'count' | 'sum' | 'avg' | 'min' | 'max',
    /** '*'' для COUNT(*) или SelectableField для SUM(field) */
    public readonly field: { tableAlias: string; fieldName: string } | '*',
  ) {}

  /** Совместимость с AggregateSelectable interface */
  get tableAlias(): string {
    return this.field === '*' ? '' : this.field.tableAlias;
  }
  get fieldName(): string {
    return this.field === '*' ? '*' : this.field.fieldName;
  }

  /** Переименовать агрегат в SELECT (возвращает новый инстанс) */
  as<A extends string>(alias: A): AggregateField<TResult> & { alias: A } {
    const copy = new AggregateField<TResult>(this.func, this.field);
    copy.alias = alias;
    return copy as AggregateField<TResult> & { alias: A };
  }
}
