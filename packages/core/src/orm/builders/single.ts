import { KadmiumSqb, type AnySelectableField } from '../sqb';
import type { WhereExpression } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import type { ModelIR } from '../../ir/index';
import type {
  FilterProxy,
  SelectProxy,
  OrderProxy,
  OrderDirection,
  UpdateFinalizer,
  HavingProxy,
  HavingSource,
} from '../types/proxy';
import type {
  AllFields,
  AnySelectable,
  IncludeConfig,
  QueryResult,
} from '../types/includes';
import type { Evaluate } from '../types/relations';
import type { AggregateFunctions } from '../field-builders/aggregates';
import { aggregates } from '../field-builders/aggregates';
import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
  createHavingProxy,
} from './query-proxies';
import {
  buildCreateFinalizer,
  buildCreateManyFinalizer,
} from './upsert-helpers';
import { buildWriteFinalizer } from './write-finalizer';
import { buildRelation, configureRelation } from './include-utils';

export class SingleQueryBuilder<
  TModel extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
    ['~relInfo']: Record<string, unknown>;
  },
  TSelect extends readonly AnySelectable[] | AllFields = AllFields,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  TInclude = {},
  TMode extends 'many' | 'first' = 'many',
> {
  public sqb: KadmiumSqb;
  private ir: ModelIR;
  private irLookup: (name: string) => ModelIR | undefined;
  private adapter: SqlAdapter | null = null;
  private _isFirst = false;

  constructor(
    ir: ModelIR,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.ir = ir;
    this.irLookup = irLookup ?? (() => undefined);
    this.adapter = adapter ?? null;
    this.sqb = new KadmiumSqb();
    this.sqb.tableContext.set(ir.name, ir.collection);
  }

  /**
   * Копия билдера: независимый sqb, общие ir/adapter.
   * go()/toSql() работают над снапшотом, поэтому базовый билдер
   * можно безопасно переиспользовать через clone().
   */
  clone(): SingleQueryBuilder<TModel, TSelect, TInclude, TMode> {
    const b = new SingleQueryBuilder<TModel, TSelect, TInclude, TMode>(
      this.ir,
      this.irLookup,
      this.adapter ?? undefined,
    );
    b.sqb = this.sqb.clone();
    b._isFirst = this._isFirst;
    return b;
  }

  // ── where / and / or — return this (no type change) ──
  // Линейная последовательность шагов: скобок/групп на уровне API нет.
  // Вложенные структуры — только через and()/or() выражения.

  where(fn: (t: FilterProxy<TModel>) => WhereExpression | undefined): this {
    this._pushWhere('AND', fn);
    return this;
  }

  and(fn: (t: FilterProxy<TModel>) => WhereExpression | undefined): this {
    return this.where(fn);
  }

  or(fn: (t: FilterProxy<TModel>) => WhereExpression | undefined): this {
    this._pushWhere('OR', fn);
    return this;
  }

  private _pushWhere(
    join: 'AND' | 'OR',
    fn: (t: FilterProxy<TModel>) => WhereExpression | undefined,
  ): void {
    const expression = fn(this._createFilterProxy());
    if (expression !== undefined) {
      this.sqb.wheres.elements.push({ join, condition: expression });
    }
  }

  // ── select — returns this with updated TSelect ──

  /** Без селектора: все поля модели. */
  select(): SingleQueryBuilder<TModel, AllFields, TInclude, TMode>;
  /** С селектором (поля + агрегаты). */
  select<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, aggregates: AggregateFunctions) => S,
  ): SingleQueryBuilder<TModel, S, TInclude, TMode>;
  select(
    fn?:
      | ((t: SelectProxy<TModel>) => SelectableField[])
      | ((t: SelectProxy<TModel>, a: AggregateFunctions) => AnySelectable[]),
  ): any {
    if (!fn) {
      const tableAlias = [...this.sqb.tableContext.keys()][0] ?? '';
      this.sqb.selects = Object.entries(this.ir.fields)
        .filter(([, f]) => !f.sourceModel)
        .map(
          ([name, f]) =>
            new SelectableField(
              tableAlias,
              name,
              undefined,
              undefined,
              f.alias,
            ),
        );
    } else {
      this.sqb.selects = fn(this._createSelectProxy(), aggregates);
    }
    return this;
  }

  // ── include — returns this with updated TInclude ──

  include<const C extends IncludeConfig<TModel>>(
    config: C,
  ): SingleQueryBuilder<TModel, TSelect, C, TMode> {
    this._resolveIncludes(config);
    return this as unknown as SingleQueryBuilder<TModel, TSelect, C, TMode>;
  }

  // ── first — returns this with TMode='first' ──

  /** first() — без селектора. */
  first(): SingleQueryBuilder<TModel, TSelect, TInclude, 'first'>;
  /** first() — с селектором (поля + агрегаты). */
  first<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, aggregates: AggregateFunctions) => S,
  ): SingleQueryBuilder<TModel, S, TInclude, 'first'>;
  first(
    fn?:
      | ((t: SelectProxy<TModel>) => SelectableField[])
      | ((t: SelectProxy<TModel>, a: AggregateFunctions) => AnySelectable[]),
  ): any {
    if (fn) {
      this.sqb.selects = [
        ...fn(this._createSelectProxy(), aggregates),
      ] as AnySelectableField[];
    } else {
      const tableAlias = [...this.sqb.tableContext.keys()][0] ?? '';
      this.sqb.selects = Object.entries(this.ir.fields)
        .filter(([, f]) => !f.sourceModel)
        .map(
          ([name, f]) =>
            new SelectableField(
              tableAlias,
              name,
              undefined,
              undefined,
              f.alias,
            ),
        );
    }
    this.sqb.limit = 1;
    this._isFirst = true;
    return this;
  }

  // ── modifiers — return this (no type change) ──

  groupBy(fn: (t: SelectProxy<TModel>) => SelectableField[]): this {
    const fields = fn(this._createSelectProxy());
    this.sqb.groupBy.push(...fields.map((f) => f.column ?? f.fieldName));
    return this;
  }

  /** Фильтр по агрегатным алиасам (HAVING). Алиасы — из select()/.as(). */
  having(
    fn: (t: HavingProxy<HavingSource<TSelect>>) => WhereExpression | undefined,
  ): this {
    this._pushHaving('AND', fn);
    return this;
  }

  /** OR-шаг для HAVING (линейная последовательность, как where/or). */
  havingOr(
    fn: (t: HavingProxy<HavingSource<TSelect>>) => WhereExpression | undefined,
  ): this {
    this._pushHaving('OR', fn);
    return this;
  }

  private _pushHaving(
    join: 'AND' | 'OR',
    fn: (t: HavingProxy<HavingSource<TSelect>>) => WhereExpression | undefined,
  ): void {
    const expression = fn(
      createHavingProxy(this.sqb, this._aggregateAliases()),
    );
    if (expression !== undefined) {
      this.sqb.havings.elements.push({ join, condition: expression });
    }
  }

  order(fn: (t: OrderProxy<TModel>) => OrderDirection[]): this {
    for (const d of fn(this._createOrderProxy())) {
      this.sqb.orders.push({
        field: d.fieldName,
        column: d.column,
        direction: d.direction,
      });
    }
    return this;
  }

  /**
   * Keyset-пагинация: продолжить выборку с ключевой позиции.
   * Семантически WHERE-условие, рендерится отдельным AND-членом в скобках.
   */
  cursor(fn: (t: FilterProxy<TModel>) => WhereExpression | undefined): this {
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

  page(page: number, size: number): this {
    if (this.sqb.cursor.elements.length > 0) {
      throw new Error('page() cannot be combined with cursor().');
    }
    this.sqb.limit = Math.max(1, size);
    this.sqb.offset = (Math.max(1, page) - 1) * size;
    return this;
  }

  /** Найти запись по первичному ключу */
  findById(
    id: TModel['~shape']['id'],
  ): SingleQueryBuilder<TModel, TSelect, TInclude, 'first'> {
    const pkEntry = Object.entries(this.ir.fields).find(
      ([, f]) => f.type === 'primary' || f.isPrimary === true,
    );
    if (!pkEntry) throw new Error('No primary key field found');
    const [pkName] = pkEntry;

    return this.where((t: any) => t[pkName].eq(id)).first();
  }

  // ── CREATE ──

  create(
    data: Record<string, unknown>,
  ): import('./upsert-helpers').CreateFinalizer<TModel> {
    if (!this.adapter) throw new Error('No adapter configured; cannot create.');
    return buildCreateFinalizer<TModel>(
      this.sqb.clone(),
      this.adapter,
      this.ir,
      this._mapAliases(data),
    );
  }

  createMany(
    data: Record<string, unknown>[],
    options?: import('./upsert-helpers').CreateManyOptions,
  ): import('./upsert-helpers').CreateManyFinalizer<TModel> {
    if (!this.adapter)
      throw new Error('No adapter configured; cannot createMany.');
    if (data.length === 0) {
      return {
        onConflict: () => this.createMany(data, options),
        doNothing: () => this.createMany(data, options),
        go: () => Promise.resolve([]),
        sql: () => '',
      };
    }
    const mapped = data.map((row) => this._mapAliases(row));
    return buildCreateManyFinalizer<TModel>(
      this.sqb.clone(),
      this.adapter,
      this.ir,
      mapped,
      options,
    );
  }

  // ── UPDATE / DELETE ──

  update(data: Record<string, unknown>): UpdateFinalizer<TModel> {
    const sqb = this.sqb.clone();
    sqb.operation = 'update';
    sqb.updateData = this._mapAliases(data);
    return buildWriteFinalizer<TModel>(
      sqb,
      this.adapter,
      () => this._createFilterProxy(),
      () => this._createSelectProxy(),
      (row) => this._mapRow(row),
    );
  }

  delete(): UpdateFinalizer<TModel> {
    const sqb = this.sqb.clone();
    sqb.operation = 'delete';
    return buildWriteFinalizer<TModel>(
      sqb,
      this.adapter,
      () => this._createFilterProxy(),
      () => this._createSelectProxy(),
      (row) => this._mapRow(row),
    );
  }

  // ── terminal — go() is the only terminal ──

  /** Выполнить запрос и вернуть результат. */
  async go(): Promise<
    TMode extends 'first'
      ? Evaluate<QueryResult<TModel, TSelect, TInclude>> | undefined
      : Evaluate<QueryResult<TModel, TSelect, TInclude>>[]
  > {
    const sqb = this.sqb.clone();
    this._materializeSelects(sqb);
    if (this.adapter) {
      const results = await this.adapter.execute(sqb);
      return this._isFirst ? (results[0] as any) : (results as any);
    }
    throw new Error('No adapter configured; cannot execute query.');
  }

  toSql(): string {
    return this._toSqlFrom(this.sqb.clone());
  }

  // ── count / exists ──

  count(): {
    go: () => Promise<number>;
    sql: () => string;
  } {
    const sqb = this.sqb.clone();
    sqb.selects = [aggregates.count('*').as('count')];
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

  exists(): {
    go: () => Promise<boolean>;
    sql: () => string;
  } {
    const sqb = this.sqb.clone();
    sqb.limit = 1;
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

  // ── private ──

  private _mapRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [prop, f] of Object.entries(this.ir.fields)) {
      const col = f.alias ?? prop;
      if (row[col] !== undefined) out[prop] = row[col];
    }
    return out;
  }

  /** Маппинг ключей данных на алиасы колонок */
  private _mapAliases(data: Record<string, unknown>): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      mapped[this.ir.fields[k]?.alias ?? k] = v;
    }
    return mapped;
  }

  private _materializeSelects(sqb: KadmiumSqb): void {
    if (sqb.selects) return;
    const tableAlias = [...sqb.tableContext.keys()][0] ?? '';
    sqb.selects = Object.entries(this.ir.fields)
      .filter(([, f]) => !f.sourceModel)
      .map(
        ([name, f]) =>
          new SelectableField(tableAlias, name, undefined, undefined, f.alias),
      );
  }

  private _toSqlFrom(sqb: KadmiumSqb): string {
    if (!this.adapter)
      throw new Error(
        'No adapter configured. Import createDebugAdapter() from @karkardmitry/kadmium-sql-pg for SQL preview, or pass a PgAdapter for database access.',
      );
    const { text, values } = this.adapter.toSql(sqb);
    return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
  }

  private _resolveIncludes(config: IncludeConfig<TModel>): void {
    for (const [relationName, relationConfig] of Object.entries(config)) {
      if (relationConfig === undefined) continue;
      const builder = buildRelation(
        this.sqb,
        this.ir,
        relationName,
        this.irLookup,
        this._alias(),
      );
      configureRelation(
        this.sqb,
        builder,
        relationConfig as unknown as Parameters<typeof configureRelation>[2],
      );
    }
  }

  private _createFilterProxy(): FilterProxy<TModel> {
    return createFilterProxy(this._alias(), this.ir, this.sqb);
  }

  private _createSelectProxy(): SelectProxy<TModel> {
    return createSelectProxy(this._alias(), this.ir);
  }

  private _createOrderProxy(): OrderProxy<TModel> {
    return createOrderProxy(this._alias(), this.ir);
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

  private _alias(): string {
    return [...this.sqb.tableContext.keys()][0] ?? this.ir.name;
  }
}
