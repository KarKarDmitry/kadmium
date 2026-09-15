import type { WhereCondition } from '../ast/where';
import type { KadmiumSqb } from '../sqb';

/**
 * BaseFilter<TValue> — базовый класс для всех фильтров.
 * Создаёт WhereCondition для AST.
 *
 * TValue — phantom-тип значения поля. Фильтры объявляют свой V
 * (StringFilter extends BaseFilter<string>, NumberFilter extends BaseFilter<number>...),
 * а методы сравнений принимают `V | BaseFilter<V>` — это даёт тип-ошибку
 * на месте использования при несовпадении типов (eq(date) в string-фильтре,
 * слот другого типа, кросс-тип поле-к-полю).
 *
 * `_value` не существует в рантайме (declare, без инициализации) — только
 * для структурной variance TypeScript. НЕ добавляйте «голый» BaseFilter
 * (= BaseFilter<unknown>) в union сигнатур сравнений: через него проходит
 * любой BaseFilter<Date>/<number> и eq-site проверка перестаёт работать.
 */
export class BaseFilter<TValue = unknown> {
  /** phantom — не существует в рантайме; только для типов */
  declare readonly _value: TValue;

  constructor(
    public readonly sqb: KadmiumSqb,
    public readonly field: string,
    public readonly alias: string,
    public readonly column?: string,
  ) {}

  protected clause(op: string, value: unknown): WhereCondition {
    return {
      alias: this.alias,
      field: this.field,
      column: this.column,
      op,
      value,
    };
  }

  /** eq(): null → IS NULL, undefined → ошибка */
  protected _eq(value: unknown): WhereCondition {
    if (value === undefined)
      throw new Error(
        'eq() called with undefined. Use eq(null) for an IS NULL check.',
      );
    if (value === null) return this.clause('IS NULL', null);
    return this.clause('=', value);
  }

  /** neq(): null → IS NOT NULL, undefined → ошибка */
  protected _neq(value: unknown): WhereCondition {
    if (value === undefined)
      throw new Error(
        'neq() called with undefined. Use neq(null) for an IS NOT NULL check.',
      );
    if (value === null) return this.clause('IS NOT NULL', null);
    return this.clause('!=', value);
  }

  /** SQL-представление поля (для field-to-field сравнений) */
  getIdentifierForSql(): string {
    return `"${this.alias}"."${this.column ?? this.field}"`;
  }
}
