import { KadmiumSqb } from '../sqb';
import type { WhereCondition, WhereGroup } from '../ast/where';

/**
 * BaseWhereBuilder — управление деревом WHERE.
 * TProxy — тип прокси для полей модели.
 */
export class BaseWhereBuilder<TProxy extends Record<string, unknown>> {
  constructor(
    protected sqb: KadmiumSqb,
    protected group: WhereGroup,
  ) {}

  where(fn: (t: TProxy) => WhereCondition): this {
    return this._add(fn, 'AND');
  }

  and(fn: (t: TProxy) => WhereCondition): this {
    return this._add(fn, 'AND');
  }

  or(fn: (t: TProxy) => WhereCondition): this {
    return this._add(fn, 'OR');
  }

  private _add(fn: (t: TProxy) => WhereCondition, op: 'AND' | 'OR'): this {
    const condition = fn(this._createProxy());
    if (this.group.conditions.length === 0) {
      this.group.op = op;
      this.group.conditions.push(condition);
      return this;
    }
    if (this.group.op === op) {
      this.group.conditions.push(condition);
      return this;
    }
    const existingGroup: WhereGroup = {
      op: this.group.op,
      conditions: [...this.group.conditions],
    };
    this.group.op = op;
    this.group.conditions = [existingGroup, condition];
    return this;
  }

  protected _createProxy(): TProxy {
    return {} as TProxy;
  }
}
