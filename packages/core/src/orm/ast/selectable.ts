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
    ) as any;
  }

  /** SQL-представление */
  toSql(): string {
    const quoted = this.alias
      ? `"${this.tableAlias}"."${this.fieldName}" AS "${this.alias}"`
      : `"${this.tableAlias}"."${this.fieldName}"`;
    return quoted;
  }
}
