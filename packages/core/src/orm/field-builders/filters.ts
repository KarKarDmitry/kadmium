import { BaseFilter } from './base-filter';
import type { WhereCondition } from '../ast/where';

export class StringFilter extends BaseFilter {
  eq(val: string | BaseFilter): WhereCondition {
    return this.clause('=', val);
  }
  neq(val: string | BaseFilter): WhereCondition {
    return this.clause('!=', val);
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
  in(vals: string[]): WhereCondition {
    return this.clause('IN', vals);
  }
}

export class NumberFilter extends BaseFilter {
  eq(val: number | BaseFilter): WhereCondition {
    return this.clause('=', val);
  }
  neq(val: number | BaseFilter): WhereCondition {
    return this.clause('!=', val);
  }
  gt(val: number | BaseFilter): WhereCondition {
    return this.clause('>', val);
  }
  gte(val: number | BaseFilter): WhereCondition {
    return this.clause('>=', val);
  }
  lt(val: number | BaseFilter): WhereCondition {
    return this.clause('<', val);
  }
  lte(val: number | BaseFilter): WhereCondition {
    return this.clause('<=', val);
  }
  between(a: number, b: number): WhereCondition {
    return this.clause('BETWEEN', [a, b]);
  }
  in(vals: number[]): WhereCondition {
    return this.clause('IN', vals);
  }
}

export class BooleanFilter extends BaseFilter {
  eq(val: boolean | BaseFilter): WhereCondition {
    return this.clause('=', val);
  }
  neq(val: boolean | BaseFilter): WhereCondition {
    return this.clause('!=', val);
  }
  true(): WhereCondition {
    return this.clause('=', true);
  }
  false(): WhereCondition {
    return this.clause('=', false);
  }
}

export class DateFilter extends BaseFilter {
  eq(val: Date | BaseFilter): WhereCondition {
    return this.clause('=', val);
  }
  neq(val: Date | BaseFilter): WhereCondition {
    return this.clause('!=', val);
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
  in(vals: Date[]): WhereCondition {
    return this.clause('IN', vals);
  }
}

/** NullableMixin — добавляет .null / .notNull */
export function addNullable(
  base: BaseFilter,
): BaseFilter & { null: WhereCondition; notNull: WhereCondition } {
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
