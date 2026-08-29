/**
 * SelectableField — поле в SELECT.
 * Несёт phantom-типы: TFieldType (TS-тип значения), TFieldName (имя поля), TAlias (алиас).
 */
export class SelectableField<
  TFieldType = unknown,
  TFieldName extends string = string,
  TAlias extends string | undefined = undefined,
  TTableAlias extends string = string,
> {
  public readonly kind = 'selectable' as const;

  constructor(
    public readonly tableAlias: TTableAlias,
    public readonly fieldName: TFieldName,
    public readonly alias?: TAlias,
    public readonly aggregate?: string,
    /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
    public readonly column?: string,
  ) {}

  /** Переименовать колонку в SELECT */
  as<T extends string>(
    alias: T,
  ): SelectableField<TFieldType, TFieldName, T, TTableAlias> {
    return new SelectableField(
      this.tableAlias,
      this.fieldName,
      alias,
      this.aggregate,
      this.column,
    ) as any;
  }

  /** SQL-представление */
  toSql(): string {
    const col = this.column ?? this.fieldName;
    const quoted = this.alias
      ? `"${this.tableAlias}"."${col}" AS "${this.alias}"`
      : `"${this.tableAlias}"."${col}"`;
    return quoted;
  }
}
