import { KadmiumSqb, orderToStep } from '../sqb';
import { SelectableField } from '../ast/selectable';
import type { WhereExpression } from '../ast/where';
import type { ModelIR } from '../../ir/index';
import {
  toSqlCondition,
  groupByToStep,
  type SqlFragment,
  type SqlOrder,
} from '../sql-fragment';
import type { OrderDirection } from '../types/proxy';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { buildDebugSql } from './utils';

/**
 * BaseQueryBuilder — приватная общая реализация шагов single/multi.
 *
 * Оба билдера разделяют одинаковые тела where/and/or/order/groupBy/limit/offset
 * и дефолтный алиас (первый ключ tableContext). Типы прокси (TFilter/TSelect/
 * TOrder) привязываются в extends-клаузе наследника, поэтому публичные методы
 * здесь уже типизированы под конкретного пользователя.
 *
 * Полиморфный `this` возвращается из конфиг-методов: наследник без переопределения
 * получает возврат своего типа. Наследники обязаны предоставить фабрики прокси и
 * fallback-алиас; переопределение возвращает тот же объект (мутация in place).
 */
export abstract class BaseQueryBuilder<TFilter, TSelect, TOrder> {
  public sqb: KadmiumSqb;
  protected adapter: SqlAdapter | null;
  protected irLookup: (name: string) => ModelIR | undefined;

  constructor(
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.sqb = new KadmiumSqb();
    this.irLookup = irLookup ?? (() => undefined);
    this.adapter = adapter ?? null;
  }

  // ── where / and / or — линейная последовательность шагов: скобок/групп на
  // уровне API нет. Вложенные структуры — только через and()/or() выражения.

  where(fn: (t: TFilter) => WhereExpression | SqlFragment | undefined): this {
    this._pushWhere('AND', fn);
    return this;
  }

  and(fn: (t: TFilter) => WhereExpression | SqlFragment | undefined): this {
    return this.where(fn);
  }

  or(fn: (t: TFilter) => WhereExpression | SqlFragment | undefined): this {
    this._pushWhere('OR', fn);
    return this;
  }

  protected _pushWhere(
    join: 'AND' | 'OR',
    fn: (t: TFilter) => WhereExpression | SqlFragment | undefined,
  ): void {
    const expression = fn(this._createFilterProxy());
    if (expression !== undefined) {
      this.sqb.wheres.elements.push({
        join,
        condition: toSqlCondition(expression),
      });
    }
  }

  groupBy(
    fn: (t: TSelect) => ReadonlyArray<SelectableField | SqlFragment>,
  ): this {
    const alias = this._defaultAlias();
    const items = fn(this._createSelectProxy());
    this.sqb.groupBy.push(...items.flatMap((f) => groupByToStep(f, alias)));
    return this;
  }

  order(
    fn: (t: TOrder) => (OrderDirection | SqlOrder<'asc' | 'desc'>)[],
  ): this {
    for (const d of fn(this._createOrderProxy())) {
      this.sqb.orders.push(orderToStep(d));
    }
    return this;
  }

  limit(n: number): this {
    this.sqb.limit = n;
    return this;
  }

  offset(n: number): this {
    if (this.sqb.cursor.elements.length > 0) {
      throw new Error('offset() cannot be combined with cursor().');
    }
    this.sqb.offset = n;
    return this;
  }

  /**
   * @deprecated Используйте `.compile()` — SQL-preview для дебага — `.compile().sql()`.
   */
  toSql(): string {
    return this._toSqlFrom(this.sqb.clone());
  }

  // ── private helpers ──

  protected _toSqlFrom(sqb: KadmiumSqb): string {
    if (!this.adapter)
      throw new Error(
        'No adapter configured. Import createDebugAdapter() from @karkardmitry/kadmium-sql-pg for SQL preview, or pass a PgAdapter for database access.',
      );
    return buildDebugSql(sqb, this.adapter);
  }

  /** Дефолтный алиас: первый ключ tableContext (single — единственная таблица). */
  protected _defaultAlias(): string {
    return [...this.sqb.tableContext.keys()][0] ?? this._fallbackAlias();
  }

  protected abstract _fallbackAlias(): string;

  protected abstract _createFilterProxy(): TFilter;
  protected abstract _createSelectProxy(): TSelect;
  protected abstract _createOrderProxy(): TOrder;
}
