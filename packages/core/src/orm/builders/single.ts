import { KadmiumSqb, type IncludedRelation } from '../sqb';
import type { WhereCondition, WhereGroup } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import { AggregateField } from '../ast/aggregate';
import { Relation, type IRelationBuilder } from '../field-builders/relation';
import type { ModelIR } from '../../ir/index';
import type {
  FilterProxy,
  SelectProxy,
  RelationProxy,
  OrderProxy,
  OrderField,
  UpdateFinalizer,
} from '../types/proxy';
import type {
  ISingleTableQuery,
  IFirstQuery,
  IncludeResult,
  BuildIncludedResult,
  FlatFinalResult,
  AnySelectable,
  Evaluate,
} from '../types/relations';
import type { AggregateFunctions } from '../field-builders/aggregates';
import { aggregates } from '../field-builders/aggregates';
import { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import { addOrCondition } from './where-helpers';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
  createRelationProxy,
} from './query-proxies';

export class SingleQueryBuilder<
  TModel extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  },
  R extends readonly IRelationBuilder<any, any, any, any, any>[] = [],
> {
  public sqb: KadmiumSqb;
  private ir: ModelIR;
  private irLookup: (name: string) => ModelIR | undefined;
  private adapter: SqlAdapter | null = null;

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

  where(fn: (t: FilterProxy<TModel>) => WhereCondition): this {
    const proxy = this._createFilterProxy();
    this.sqb.wheres.conditions.push(fn(proxy));
    return this;
  }

  and(fn: (t: FilterProxy<TModel>) => WhereCondition): this {
    return this.where(fn);
  }

  or(fn: (t: FilterProxy<TModel>) => WhereCondition): this {
    const proxy = this._createFilterProxy();
    addOrCondition(this.sqb.wheres, fn(proxy));
    return this;
  }

  /** Создать вложенную группу условий (скобки) */
  group(callback: (q: this) => void): this {
    const newGroup: WhereGroup = { op: 'AND', conditions: [] };
    const saved = {
      wheres: this.sqb.wheres,
    };
    this.sqb.wheres = newGroup;

    try {
      callback(this);
    } finally {
      if (newGroup.conditions.length > 0) {
        saved.wheres.conditions.push(newGroup);
      }
      this.sqb.wheres = saved.wheres;
    }

    return this;
  }

  // ── select overloads ──

  /** Без селектора: выбираются все поля модели + включённые связи. */
  select(): ISingleTableQuery<TModel, R, Evaluate<IncludeResult<TModel, R>>>;
  /** С селектором (поля + агрегаты). */
  select<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, aggregates: AggregateFunctions) => S,
  ): ISingleTableQuery<
    TModel,
    R,
    Evaluate<FlatFinalResult<S> & BuildIncludedResult<TModel, R>>
  >;
  select(
    fn?:
      | ((t: SelectProxy<TModel>) => SelectableField[])
      | ((t: SelectProxy<TModel>, a: AggregateFunctions) => AnySelectable[]),
  ): any {
    if (!fn) {
      // Явно перечисляем все поля модели вместо SELECT *
      const tableAlias = [...this.sqb.tableContext.keys()][0] ?? '';
      this.sqb.selects = Object.entries(this.ir.fields)
        .filter(([, f]) => !f.sourceModel) // пропускаем виртуальные (inverse)
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
    return this._buildSelectFinalizer();
  }

  // ── include ──

  include<
    const R2 extends readonly IRelationBuilder<any, any, any, any, any>[],
  >(
    selector: (relations: RelationProxy<TModel>) => R2,
  ): SingleQueryBuilder<TModel, [...R, ...R2]> {
    const builders = selector(this._createRelationProxy());
    for (const builder of builders) {
      this.sqb.includes.push(builder as any);
    }
    return this as unknown as SingleQueryBuilder<TModel, [...R, ...R2]>;
  }

  // ── first ──

  /** first() — без селектора. */
  first(): IFirstQuery<
    TModel,
    R,
    Evaluate<IncludeResult<TModel, R>> | undefined
  >;
  /** first() — с селектором (поля + агрегаты). */
  first<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, aggregates: AggregateFunctions) => S,
  ): IFirstQuery<
    TModel,
    R,
    Evaluate<FlatFinalResult<S> & BuildIncludedResult<TModel, R>>
  >;
  first(
    fn?:
      | ((t: SelectProxy<TModel>) => SelectableField[])
      | ((t: SelectProxy<TModel>, a: AggregateFunctions) => AnySelectable[]),
  ): any {
    if (fn) {
      this.sqb.selects = fn(this._createSelectProxy(), aggregates) as any;
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
    return this._buildFirstFinalizer();
  }

  // ── modifiers ──

  groupBy(fn: (t: SelectProxy<TModel>) => SelectableField[]): this {
    const fields = fn(this._createSelectProxy());
    this.sqb.groupBy.push(...fields.map((f) => f.column ?? f.fieldName));
    return this;
  }

  order(
    fn: (t: OrderProxy<TModel>) => OrderField,
    dir: 'asc' | 'desc' = 'asc',
  ): this {
    const field = fn(this._createOrderProxy());
    this.sqb.orders.push({
      field: field.fieldName,
      column: field.column,
      direction: dir,
    });
    return this;
  }

  limit(n: number): this {
    this.sqb.limit = n;
    return this;
  }

  offset(n: number): this {
    this.sqb.offset = n;
    return this;
  }

  page(page: number, size: number): this {
    this.sqb.limit = Math.max(1, size);
    this.sqb.offset = (Math.max(1, page) - 1) * size;
    return this;
  }

  /** Найти запись по первичному ключу */
  findById(
    id: TModel['~shape']['id'],
  ): IFirstQuery<TModel, R, Evaluate<IncludeResult<TModel, R>> | undefined> {
    const pkEntry = Object.entries(this.ir.fields).find(
      ([, f]) => f.type === 'primary' || f.isPrimary === true,
    );
    if (!pkEntry) throw new Error('No primary key field found');
    const [pkName] = pkEntry;

    return this.where((t: any) => t[pkName].eq(id)).first();
  }

  /** Создать запись и вернуть вставленную строку. */
  create(
    data: Record<string, unknown>,
  ): Promise<Evaluate<IncludeResult<TModel, R>>> {
    if (!this.adapter) throw new Error('No adapter configured; cannot create.');
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      mapped[this.ir.fields[k]?.alias ?? k] = v;
    }
    return this.adapter
      .create(this.ir.collection, mapped)
      .then((row) => this._mapRow(row)) as Promise<
      Evaluate<IncludeResult<TModel, R>>
    >;
  }

  // ── UPDATE / DELETE ──

  update(data: Record<string, unknown>): UpdateFinalizer<TModel> {
    this.sqb.operation = 'update';
    // Ключи — имена свойств; в SET подставляем имена колонок (alias)
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      mapped[this.ir.fields[k]?.alias ?? k] = v;
    }
    this.sqb.updateData = mapped as any;

    const go = async () => {
      if (!this.adapter)
        throw new Error(
          'No adapter configured; call .go() only with an adapter.',
        );
      const rows = await this.adapter.execute(this.sqb);
      return rows.map((r) => this._mapRow(r));
    };
    const sql = () => this.toSql();

    return {
      where: (clause) => {
        const proxy = this._createFilterProxy();
        this.sqb.wheres.conditions.push(clause(proxy));
        return { go, sql };
      },
      go,
      sql,
    };
  }

  delete(): UpdateFinalizer<TModel> {
    this.sqb.operation = 'delete';

    const go = async () => {
      if (!this.adapter)
        throw new Error(
          'No adapter configured; call .go() only with an adapter.',
        );
      const rows = await this.adapter.execute(this.sqb);
      return rows.map((r) => this._mapRow(r));
    };
    const sql = () => this.toSql();

    return {
      where: (clause) => {
        const proxy = this._createFilterProxy();
        this.sqb.wheres.conditions.push(clause(proxy));
        return { go, sql };
      },
      go,
      sql,
    };
  }

  // ── terminal ──

  toSql(): string {
    if (!this.adapter)
      throw new Error(
        'No SQL adapter configured. Use .go() only with an adapter.',
      );
    const { text, values } = this.adapter.toSql(this.sqb);
    return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
  }

  /** Выполнить запрос и вернуть все поля модели + включённые связи */
  go(): Promise<Evaluate<IncludeResult<TModel, R>>[]> {
    if (!this.sqb.selects) {
      // Авто-выбор всех полей если select() не вызывался
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
    if (this.adapter) {
      return this.adapter.execute(this.sqb) as Promise<
        IncludeResult<TModel, R>[]
      >;
    }
    throw new Error('No adapter configured; cannot execute query.');
  }

  // ── count / exists ──

  /** COUNT(*) — количество записей */
  count(): {
    go: () => Promise<number>;
    sql: () => string;
  } {
    this.select(() => [aggregates.count('*').as('count')] as any);
    return {
      sql: () => this.toSql(),
      go: async (): Promise<number> => {
        const results = (await this.go()) as any;
        return Number(results[0]?.count ?? 0);
      },
    };
  }

  /** EXISTS — есть ли хотя бы одна запись */
  exists(): {
    go: () => Promise<boolean>;
    sql: () => string;
  } {
    this.limit(1);
    return {
      sql: () => this.toSql(),
      go: async (): Promise<boolean> => {
        const results = await this.go();
        return results.length > 0;
      },
    };
  }

  // ── private ──

  /** Перевести строку с ключами-колонками в ключи-свойства (alias → property). */
  private _mapRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [prop, f] of Object.entries(this.ir.fields)) {
      const col = f.alias ?? prop;
      if (row[col] !== undefined) out[prop] = row[col];
    }
    return out;
  }

  private _buildSelectFinalizer(): ISingleTableQuery<TModel, R, any> {
    const finalizer: ISingleTableQuery<TModel, R, any> = {
      where: (clause) => {
        this.where(clause as any);
        return finalizer;
      },
      and: (clause) => {
        this.and(clause as any);
        return finalizer;
      },
      or: (clause) => {
        this.or(clause as any);
        return finalizer;
      },

      group: (callback) => {
        this.group(callback as any);
        return finalizer;
      },
      order: (fn, dir) => {
        this.order(fn as any, dir);
        return finalizer;
      },
      limit: (n) => {
        this.limit(n);
        return finalizer;
      },
      offset: (n) => {
        this.offset(n);
        return finalizer;
      },
      page: (p, size) => {
        this.page(p, size);
        return finalizer;
      },
      groupBy: (fn) => {
        this.groupBy(fn);
        return finalizer;
      },
      toSql: () => this.toSql(),
      go: () => this.go(),
    };
    return finalizer;
  }

  private _buildFirstFinalizer(): IFirstQuery<TModel, R, any> {
    const finalizer: IFirstQuery<TModel, R, any> = {
      toSql: () => this.toSql(),
      go: async () => {
        const results = await this.go();
        return results[0];
      },
    };
    return finalizer;
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

  private _createRelationProxy(): RelationProxy<TModel> {
    return createRelationProxy(
      this._alias(),
      this.ir,
      this.sqb,
      Relation as unknown as import('./query-proxies').RelationFactory,
      this.irLookup,
    );
  }

  private _alias(): string {
    return [...this.sqb.tableContext.keys()][0] ?? this.ir.name;
  }
}
