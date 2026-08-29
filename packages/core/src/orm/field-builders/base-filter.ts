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

  /** SQL-представление поля (для field-to-field сравнений) */
  getIdentifierForSql(): string {
    return `"${this.alias}"."${this.column ?? this.field}"`;
  }
}
