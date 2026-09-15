/**
 * ArrayField — массив-слот (План 3, B1): type-only фантом для `SelectableField.array`.
 * Значение-тип = TValue (массив элементов модели), т.е. `u.id.array` → `ArrayField<number[], 'id'>`.
 *
 * НЕ extends SelectableField: семантически это не колонка, поэтому `select(u => [u.id.array])`
 * — тип-ошибка (ArrayField не входит в AnySelectable). Нужен для декларации слотов
 * `QuerySlots.push(...)` и `t.id.in(S.slot('ids'))`.
 *
 * `.array` и `.as()` коммутируют: `u.id.array.as('ids')` ≡ `u.id.as('x').array` — один слот-тип.
 */
export class ArrayField<
  TValue = unknown,
  TFieldName extends string = string,
  TAlias extends string | undefined = undefined,
> {
  public readonly kind = 'array' as const;

  constructor(
    public readonly tableAlias: string,
    public readonly fieldName: TFieldName,
    public readonly alias?: TAlias,
  ) {}

  /** Переименовать массив-слот в SELECT-проекции слота */
  as<A extends string>(alias: A): ArrayField<TValue, TFieldName, A> {
    return new ArrayField<TValue, TFieldName, A>(
      this.tableAlias,
      this.fieldName,
      alias,
    );
  }
}

export type AnyArrayField = ArrayField<any, any, any>;
