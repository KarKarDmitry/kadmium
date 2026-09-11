import type { WhereCondition } from '../ast/where';
import type { KadmiumSqb } from '../sqb';

/**
 * BaseFilter — базовый класс для всех фильтров.
 * Создаёт WhereCondition для AST.
 */
export class BaseFilter {
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
