import type {
  SqlAdapter,
  CompiledQuery,
  HoleRef,
} from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../ir/index';
import { KadmiumSqb, type AnySelectableField } from '../sqb';
import { SelectableField } from '../ast/selectable';
import type { AnyArrayField } from '../ast/array-field';
import type { CursorWhereExpression, WhereExpression } from '../ast/where';
import {
  toSqlCondition,
  type SqlFragment,
  type SqlOrder,
} from '../sql-fragment';
import type {
  FilterProxy,
  SelectProxy,
  OrderProxy,
  HavingProxy,
  HavingSource,
  SelectTools,
  OrderDirection,
} from '../types/proxy';
import type {
  AllFields,
  AnySelectable,
  IncludeConfig,
  QueryResult,
} from '../types/includes';
import type { Evaluate } from '../types/relations';
import type { SlotNameGuard } from '../types/phantom';
import { QuerySlots, type ToDef } from '../query-slots';
import { aggregates } from '../field-builders/aggregates';
import { windowFunctions } from '../field-builders/window-functions';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
  createHavingProxy,
} from './query-proxies';
import { buildRelation, configureRelation } from './include-utils';
import { BaseQueryBuilder } from './base-query-builder';

/** Минимальный контракт модели, нужный select-билдеру. */
type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

/**
 * Терминал count()/exists() с SQL-превью.
 *
 * `sql()` помечен @deprecated (единый путь к SQL — `.compile().sql()`),
 * но остаётся, потому что count/exists — терминалы, а не билдеры,
 * и `.compile()` у них нет.
 */
export interface SqlPreviewTerminal<TExec> {
  go(): Promise<TExec>;
  /** @deprecated Используйте `.compile().sql()`. */
  sql(): string;
}

/**
 * Шаги конфигурации, нейтральные к состоянию SELECT — возвращают `this`.
 *
 * Полиморфный `this` (как в `SingleShared`): `where` не «съедает» ветку,
 * потому что в select-API веток ровно одна — в отличие от single, где
 * порядок вызовов меняет доступность DML.
 */
interface SelectShared<
  M extends Model,
  S extends readonly AnySelectable[] | AllFields,
> {
  /** Текущий снапшот запроса (тестовый/дебаг-доступ к AST). */
  readonly sqb: KadmiumSqb;

  where(
    fn: (t: FilterProxy<M>) => WhereExpression | SqlFragment | undefined,
  ): this;
  and(
    fn: (t: FilterProxy<M>) => WhereExpression | SqlFragment | undefined,
  ): this;
  or(
    fn: (t: FilterProxy<M>) => WhereExpression | SqlFragment | undefined,
  ): this;
  having(
    fn: (
      t: HavingProxy<HavingSource<S>>,
    ) => WhereExpression | SqlFragment | undefined,
  ): this;
  havingOr(
    fn: (
      t: HavingProxy<HavingSource<S>>,
    ) => WhereExpression | SqlFragment | undefined,
  ): this;
  order(
    fn: (t: OrderProxy<M>) => (OrderDirection | SqlOrder<'asc' | 'desc'>)[],
  ): this;
  groupBy(
    fn: (t: SelectProxy<M>) => ReadonlyArray<SelectableField | SqlFragment>,
  ): this;
  limit(n: number): this;
  offset(n: number): this;
  page(page: number, size: number): this;
  cursor(fn: (t: FilterProxy<M>) => CursorWhereExpression | undefined): this;
  clone(): this;

  /**
   * @deprecated SQL-preview для дебага. Канонический путь к тексту — `.compile()`
   *   (`{ text, values, slotOrder }`); этот метод лишь оборачивает его в
   *   `"SQL: … VALUES: […]"` и доступен ради отладочных логов.
   */
  toSql(): string;
}

/**
 * Публичная поверхность `orm.select(Model)`.
 *
 * Объявлена рядом с билдером, а не в общем `handles.ts`: у каждой операции
 * свой вход и свой набор методов — `update`/`delete`/`insert` не должны
 * появляться на том, что может только читать (см. `plans/crud-api.md`).
 *
 * `Mo` несёт режим терминала: после `first()` и `go()`, и `compile()`
 * разворачивают массив в один объект — иначе тип врал бы вызывающему.
 */
export interface SelectHandle<
  M extends Model,
  S extends readonly AnySelectable[] | AllFields = AllFields,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  C = {},
  Mo extends 'many' | 'first' = 'many',
> extends SelectShared<M, S> {
  /** Проекция: поля, агрегаты, оконные функции. Без аргумента — все поля. */
  fields(): SelectHandle<M, AllFields, C, Mo>;
  fields<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SelectHandle<M, NS, C, Mo>;
  fields<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SelectHandle<M, NS, C, Mo>;
  fields<NS extends AnySelectable>(item: NS): SelectHandle<M, [NS], C, Mo>;

  /**
   * Include-конфиг: структурный объект, связь выбирается КЛЮЧОМ,
   * а не прокси-значением — `{ posts: true }`, `{ posts: { where, order } }`.
   * Вложенность — через `include` внутри значения.
   */
  include<const NC extends IncludeConfig<M>>(
    config: NC,
  ): SelectHandle<M, S, NC, Mo>;

  /** Одна строка (ставит limit=1). С проекцией — `first(t => [t.id])`. */
  first(): SelectHandle<M, S, C, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SelectHandle<M, NS, C, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SelectHandle<M, NS, C, 'first'>;
  first<NS extends AnySelectable>(item: NS): SelectHandle<M, [NS], C, 'first'>;

  /** S2: число строк под фильтром. Пагинация (limit/offset) не влияет. */
  count(): SqlPreviewTerminal<number>;
  /** S3: есть ли хоть одна строка. offset не влияет. */
  exists(): SqlPreviewTerminal<boolean>;

  go(): Promise<
    Mo extends 'first'
      ? Evaluate<QueryResult<M, S, C>> | undefined
      : Evaluate<QueryResult<M, S, C>>[]
  >;

  compile<
    T extends Record<string, unknown> = Record<string, never>,
  >(): CompiledQuery<
    T,
    Mo extends 'first'
      ? Evaluate<QueryResult<M, S, C>> | undefined
      : Evaluate<QueryResult<M, S, C>>[]
  >;
  compile<SS extends readonly (AnySelectable | AnyArrayField)[]>(
    slots: QuerySlots<M, SS>,
  ): CompiledQuery<
    ToDef<SS>,
    Mo extends 'first'
      ? Evaluate<QueryResult<M, S, C>> | undefined
      : Evaluate<QueryResult<M, S, C>>[]
  >;
}

/** Агрегаты + оконные функции — второй аргумент коллбэка `fields()`. */
const selectTools: SelectTools = {
  agg: aggregates,
  wf: windowFunctions,
};

/**
 * Билдер операции SELECT.
 *
 * Наследует `BaseQueryBuilder` — тот содержит `where/and/or/groupBy/order/
 * limit/offset` и abstract-фабрики прокси, поэтому здесь они не дублируются.
 * Наследование законно: в SELECT все эти шаги рендерятся. У update/delete
 * общий DML-родитель НЕ нужен — там своя финализация (см. `plans/crud-api.md`),
 * но SELECT-шаги у них общие с single, поэтому переиспользуем базу.
 *
 * Терминалы: `go` (строки), `first` (одна строка), `count`, `exists`, `compile`.
 */
export class SelectQueryBuilder<
  TModel extends Model,
  TSelect extends readonly AnySelectable[] | AllFields = AllFields,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TInclude = {},
  TMode extends 'many' | 'first' = 'many',
> extends BaseQueryBuilder<
  FilterProxy<TModel>,
  SelectProxy<TModel>,
  OrderProxy<TModel>
> {
  private ir: ModelIR;
  private _isFirst = false;

  constructor(
    ir: ModelIR,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    super(irLookup, adapter);
    this.ir = ir;
    this.sqb.tableContext.set(ir.name, ir.collection);
  }

  /** Снапшот билдера: независимый sqb, общие ir/adapter. */
  clone(): SelectQueryBuilder<TModel, TSelect, TInclude, TMode> {
    const b = new SelectQueryBuilder<TModel, TSelect, TInclude, TMode>(
      this.ir,
      this.irLookup,
      this.adapter ?? undefined,
    );
    b.sqb = this.sqb.clone();
    b._isFirst = this._isFirst;
    return b;
  }

  // ── fields — проекция (бывший select(), переименован согласно плану) ──

  fields(): SelectQueryBuilder<TModel, AllFields, TInclude, TMode>;
  fields<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: SelectTools) => NS,
  ): SelectQueryBuilder<TModel, NS, TInclude, TMode>;
  fields<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SelectQueryBuilder<TModel, NS, TInclude, TMode>;
  fields<NS extends AnySelectable>(
    item: NS,
  ): SelectQueryBuilder<TModel, [NS], TInclude, TMode>;
  fields(
    arg?:
      | ((
          t: SelectProxy<TModel>,
          tools: SelectTools,
        ) => readonly AnySelectable[])
      | readonly AnySelectable[]
      | AnySelectable,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    if (arg === undefined) {
      this.sqb.selects = this._buildAllSelects();
    } else if (typeof arg === 'function') {
      this.sqb.selects = [
        ...arg(this._createSelectProxy(), selectTools),
      ] as AnySelectableField[];
    } else if (Array.isArray(arg)) {
      this.sqb.selects = [...arg] as AnySelectableField[];
    } else {
      this.sqb.selects = [arg] as AnySelectableField[];
    }
    return this;
  }

  // ── include ──

  include<const C extends IncludeConfig<TModel>>(
    config: C,
  ): SelectQueryBuilder<TModel, TSelect, C, TMode> {
    for (const [relationName, relationConfig] of Object.entries(config)) {
      if (relationConfig === undefined) continue;
      const builder = buildRelation(
        this.sqb,
        this.ir,
        relationName,
        this.irLookup,
        this._defaultAlias(),
      );
      configureRelation(
        this.sqb,
        builder,
        relationConfig as unknown as Parameters<typeof configureRelation>[2],
      );
    }
    return this as unknown as SelectQueryBuilder<TModel, TSelect, C, TMode>;
  }

  // ── having ──

  having(
    fn: (
      t: HavingProxy<HavingSource<TSelect>>,
    ) => WhereExpression | SqlFragment | undefined,
  ): this {
    this._pushHaving('AND', fn);
    return this;
  }

  havingOr(
    fn: (
      t: HavingProxy<HavingSource<TSelect>>,
    ) => WhereExpression | SqlFragment | undefined,
  ): this {
    this._pushHaving('OR', fn);
    return this;
  }

  private _pushHaving(
    join: 'AND' | 'OR',
    fn: (
      t: HavingProxy<HavingSource<TSelect>>,
    ) => WhereExpression | SqlFragment | undefined,
  ): void {
    const expression = fn(
      createHavingProxy(this.sqb, this._aggregateAliases()),
    );
    if (expression !== undefined) {
      this.sqb.havings.elements.push({
        join,
        condition: toSqlCondition(expression),
      });
    }
  }

  // ── pagination ──

  /**
   * Keyset-пагинация: продолжить выборку с ключевой позиции.
   * Семантически WHERE-условие; sql-фрагменты тут не принимаются.
   * Требует `order()` раньше; конфликтует с `offset()/page()`.
   */
  cursor(
    fn: (t: FilterProxy<TModel>) => CursorWhereExpression | undefined,
  ): this {
    if (this.sqb.orders.length === 0) {
      throw new Error(
        'cursor() requires an order: call .order() before .cursor().',
      );
    }
    if (this.sqb.offset !== null) {
      throw new Error('cursor() cannot be combined with offset()/page().');
    }
    if (this.sqb.cursor.elements.length > 0) {
      throw new Error('cursor() is already set.');
    }
    const expression = fn(this._createFilterProxy());
    if (expression !== undefined) {
      this.sqb.cursor.elements.push({ join: 'AND', condition: expression });
    }
    return this;
  }

  page(page: number, size: number): this {
    if (this.sqb.cursor.elements.length > 0) {
      throw new Error('page() cannot be combined with cursor().');
    }
    this.sqb.limit = Math.max(1, size);
    this.sqb.offset = (Math.max(1, page) - 1) * size;
    return this;
  }

  // ── first ──

  first(): SelectQueryBuilder<TModel, TSelect, TInclude, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: SelectTools) => NS,
  ): SelectQueryBuilder<TModel, NS, TInclude, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SelectQueryBuilder<TModel, NS, TInclude, 'first'>;
  first<NS extends AnySelectable>(
    item: NS,
  ): SelectQueryBuilder<TModel, [NS], TInclude, 'first'>;
  first(
    arg?:
      | ((
          t: SelectProxy<TModel>,
          tools: SelectTools,
        ) => readonly AnySelectable[])
      | readonly AnySelectable[]
      | AnySelectable,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    if (arg === undefined) {
      this.sqb.selects = this._buildAllSelects();
    } else {
      this.fields(arg as never);
    }
    this.sqb.limit = 1;
    this._isFirst = true;
    return this;
  }

  // ── terminals ──

  async go(): Promise<
    TMode extends 'first'
      ? Evaluate<QueryResult<TModel, TSelect, TInclude>> | undefined
      : Evaluate<QueryResult<TModel, TSelect, TInclude>>[]
  > {
    const sqb = this.sqb.clone();
    this._materializeSelects(sqb);
    if (!this.adapter)
      throw new Error('No adapter configured; cannot execute query.');
    const results = await this.adapter.execute(sqb);
    return (this._isFirst ? results[0] : results) as never;
  }

  compile<
    T extends Record<string, unknown> = Record<string, never>,
  >(): CompiledQuery<
    T,
    TMode extends 'first'
      ? Evaluate<QueryResult<TModel, TSelect, TInclude>> | undefined
      : Evaluate<QueryResult<TModel, TSelect, TInclude>>[]
  >;
  compile<SS extends readonly (AnySelectable | AnyArrayField)[]>(
    slots: QuerySlots<TModel, SS>,
  ): CompiledQuery<
    ToDef<SS>,
    TMode extends 'first'
      ? Evaluate<QueryResult<TModel, TSelect, TInclude>> | undefined
      : Evaluate<QueryResult<TModel, TSelect, TInclude>>[]
  >;
  compile(
    slots?: SlotNameGuard,
  ): CompiledQuery<Record<string, unknown>, unknown> {
    const sqb = this.sqb.clone();
    this._materializeSelects(sqb);
    if (!this.adapter)
      throw new Error('No adapter configured; cannot compile SQL.');
    const { text, values, slotOrder } = this.adapter.toSql(sqb);
    slots?.assertSlotNames(slotOrder ?? []);
    return {
      text,
      values: values as (unknown | HoleRef)[],
      slotOrder: slotOrder ?? [],
      single: this._isFirst,
      sqb,
    } as unknown as CompiledQuery<Record<string, unknown>, unknown>;
  }

  /**
   * S2: count() считает ВСЕ строки под фильтром — пагинация
   * (limit/offset) не должна влиять на результат.
   */
  count(): SqlPreviewTerminal<number> {
    const sqb = this.sqb.clone();
    sqb.selects = [aggregates.count('*').as('count')];
    sqb.limit = null;
    sqb.offset = null;
    return {
      sql: () => this._toSqlFrom(sqb),
      go: async (): Promise<number> => {
        if (!this.adapter)
          throw new Error('No adapter configured; cannot execute query.');
        const results = await this.adapter.execute(sqb);
        return Number(results[0]?.count ?? 0);
      },
    };
  }

  /**
   * S3: exists() проверяет наличие ЛЮБОЙ строки — offset не влияет.
   */
  exists(): SqlPreviewTerminal<boolean> {
    const sqb = this.sqb.clone();
    sqb.limit = 1;
    sqb.offset = null;
    this._materializeSelects(sqb);
    return {
      sql: () => this._toSqlFrom(sqb),
      go: async (): Promise<boolean> => {
        if (!this.adapter)
          throw new Error('No adapter configured; cannot execute query.');
        const results = await this.adapter.execute(sqb);
        return results.length > 0;
      },
    };
  }

  // ── BaseQueryBuilder contract ──

  protected _fallbackAlias(): string {
    return this.ir.name;
  }

  protected _createFilterProxy(): FilterProxy<TModel> {
    return createFilterProxy(this._defaultAlias(), this.ir, this.sqb);
  }

  protected _createSelectProxy(): SelectProxy<TModel> {
    return createSelectProxy(this._defaultAlias(), this.ir);
  }

  protected _createOrderProxy(): OrderProxy<TModel> {
    return createOrderProxy(this._defaultAlias(), this.ir);
  }

  // ── private ──

  private _buildAllSelects(): AnySelectableField[] {
    const tableAlias = this._defaultAlias();
    return Object.entries(this.ir.fields)
      .filter(([, f]) => !f.sourceModel)
      .map(
        ([name, f]) =>
          new SelectableField(tableAlias, name, undefined, undefined, f.alias),
      );
  }

  private _materializeSelects(sqb: KadmiumSqb): void {
    if (sqb.selects) return;
    sqb.selects = this._buildAllSelects();
  }

  /** Алиасы агрегатов из текущего select — допустимые ключи для having(). */
  private _aggregateAliases(): Set<string> {
    const aliases = new Set<string>();
    if (this.sqb.selects) {
      for (const sel of this.sqb.selects) {
        if (sel.kind === 'aggregate' && sel.alias) aliases.add(sel.alias);
      }
    }
    return aliases;
  }
}
