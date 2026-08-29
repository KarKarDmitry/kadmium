/**
 * AggregateField — агрегатная функция в SELECT (COUNT, SUM, AVG, MIN, MAX).
 * Несёт phantom-тип TResult для type-level инференса результата.
 * Совместим с SelectableField интерфейсом из sql-types (toSql, alias, tableAlias, fieldName).
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

  /** Совместимость с SelectableField interface */
  get tableAlias(): string {
    return this.field === '*' ? '' : this.field.tableAlias;
  }
  get fieldName(): string {
    return this.field === '*' ? '*' : this.field.fieldName;
  }

  /** Переименовать агрегат в SELECT */
  as<A extends string>(alias: A): this & { alias: A } {
    this.alias = alias;
    return this as any;
  }

  /** SQL-представление */
  toSql(): string {
    if (!this.alias) throw new Error('Aggregate must have an alias');
    const inner =
      this.field === '*'
        ? '*'
        : `"${this.field.tableAlias}"."${this.field.fieldName}"`;
    return `${this.func.toUpperCase()}(${inner}) AS "${this.alias}"`;
  }
}
