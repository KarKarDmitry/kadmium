/**
 * SelectableField — поле в SELECT.
 * Несёт phantom-типы: TFieldType (TS-тип значения), TFieldName (имя поля), TAlias (алиас).
 */
import type { OrderDirection } from '../types/proxy';

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

  /** Направление сортировки для ORDER BY (используется в окнах: orderBy(p.views.desc)). */
  get asc(): OrderDirection {
    return {
      tableAlias: this.tableAlias,
      fieldName: this.fieldName,
      column: this.column,
      direction: 'asc',
    };
  }

  get desc(): OrderDirection {
    return {
      tableAlias: this.tableAlias,
      fieldName: this.fieldName,
      column: this.column,
      direction: 'desc',
    };
  }

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
}
