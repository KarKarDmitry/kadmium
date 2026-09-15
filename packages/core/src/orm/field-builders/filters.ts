import { BaseFilter } from './base-filter';
import type { WhereCondition } from '../ast/where';

export class StringFilter extends BaseFilter<string> {
  eq(val: string | BaseFilter<string>): WhereCondition {
    return this._eq(val);
  }
  neq(val: string | BaseFilter<string>): WhereCondition {
    return this._neq(val);
  }
  gt(val: string | BaseFilter<string>): WhereCondition {
    return this.clause('>', val);
  }
  gte(val: string | BaseFilter<string>): WhereCondition {
    return this.clause('>=', val);
  }
  lt(val: string | BaseFilter<string>): WhereCondition {
    return this.clause('<', val);
  }
  lte(val: string | BaseFilter<string>): WhereCondition {
    return this.clause('<=', val);
  }
  between(a: string, b: string): WhereCondition {
    return this.clause('BETWEEN', [a, b]);
  }
  like(val: string): WhereCondition {
    return this.clause('LIKE', `%${val}%`);
  }
  ilike(val: string): WhereCondition {
    return this.clause('ILIKE', `%${val}%`);
  }
  start(val: string): WhereCondition {
    return this.clause('LIKE', `${val}%`);
  }
  istart(val: string): WhereCondition {
    return this.clause('ILIKE', `${val}%`);
  }
  end(val: string): WhereCondition {
    return this.clause('LIKE', `%${val}`);
  }
  iend(val: string): WhereCondition {
    return this.clause('ILIKE', `%${val}`);
  }
  in(vals: string[] | BaseFilter<string[]>): WhereCondition {
    return this.clause('IN', vals);
  }
}

export class NumberFilter extends BaseFilter<number> {
  eq(val: number | BaseFilter<number>): WhereCondition {
    return this._eq(val);
  }
  neq(val: number | BaseFilter<number>): WhereCondition {
    return this._neq(val);
  }
  gt(val: number | BaseFilter<number>): WhereCondition {
    return this.clause('>', val);
  }
  gte(val: number | BaseFilter<number>): WhereCondition {
    return this.clause('>=', val);
  }
  lt(val: number | BaseFilter<number>): WhereCondition {
    return this.clause('<', val);
  }
  lte(val: number | BaseFilter<number>): WhereCondition {
    return this.clause('<=', val);
  }
  between(a: number, b: number): WhereCondition {
    return this.clause('BETWEEN', [a, b]);
  }
  in(vals: number[] | BaseFilter<number[]>): WhereCondition {
    return this.clause('IN', vals);
  }
}

export class BooleanFilter extends BaseFilter<boolean> {
  eq(val: boolean | BaseFilter<boolean>): WhereCondition {
    return this._eq(val);
  }
  neq(val: boolean | BaseFilter<boolean>): WhereCondition {
    return this._neq(val);
  }
  true(): WhereCondition {
    return this.clause('=', true);
  }
  false(): WhereCondition {
    return this.clause('=', false);
  }
}

export class DateFilter extends BaseFilter<Date> {
  eq(val: Date | BaseFilter<Date>): WhereCondition {
    return this._eq(val);
  }
  neq(val: Date | BaseFilter<Date>): WhereCondition {
    return this._neq(val);
  }
  after(val: Date): WhereCondition {
    return this.clause('>', val);
  }
  afterEq(val: Date): WhereCondition {
    return this.clause('>=', val);
  }
  before(val: Date): WhereCondition {
    return this.clause('<', val);
  }
  beforeEq(val: Date): WhereCondition {
    return this.clause('<=', val);
  }
  between(a: Date, b: Date): WhereCondition {
    return this.clause('BETWEEN', [a, b]);
  }
  in(vals: Date[] | BaseFilter<Date[]>): WhereCondition {
    return this.clause('IN', vals);
  }
}

/** NullableMixin — добавляет .null / .notNull */
export function addNullable<TValue = unknown>(
  base: BaseFilter<TValue>,
): BaseFilter<TValue> & { null: WhereCondition; notNull: WhereCondition } {
  return Object.assign(base, {
    get null(): WhereCondition {
      return {
        alias: base.alias,
        field: base.field,
        column: base.column,
        op: 'IS NULL',
        value: null,
      };
    },
    get notNull(): WhereCondition {
      return {
        alias: base.alias,
        field: base.field,
        column: base.column,
        op: 'IS NOT NULL',
        value: null,
      };
    },
  });
}
