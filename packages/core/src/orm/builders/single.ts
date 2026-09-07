import { KadmiumSqb } from '../sqb';
import type { WhereCondition, WhereGroup } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import { Relation } from '../field-builders/relation';
import type { ModelIR } from '../../ir/index';
import type {
  FilterProxy,
  SelectProxy,
  OrderProxy,
  OrderField,
  UpdateFinalizer,
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
import { addOrCondition } from './where-helpers';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
} from './query-proxies';
import {
  buildCreateFinalizer,
  buildCreateManyFinalizer,
} from './upsert-helpers';
import { toSnakeCase } from '../../ir/index';

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

  // ── where / and / or / group — return this (no type change) ──

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

  include<C extends IncludeConfig<TModel>>(
    config: C,
  ): SingleQueryBuilder<TModel, TSelect, C, TMode> {
    this._resolveIncludes(config);
    return this as any;
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
    this._isFirst = true;
    return this;
  }

  // ── modifiers — return this (no type change) ──

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
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      mapped[this.ir.fields[k]?.alias ?? k] = v;
    }
    return buildCreateFinalizer<TModel>(
      this.sqb,
      this.adapter,
      this.ir,
      mapped,
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
    const mapped = data.map((row) => {
      const m: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        m[this.ir.fields[k]?.alias ?? k] = v;
      }
      return m;
    });
    return buildCreateManyFinalizer<TModel>(
      this.sqb,
      this.adapter,
      this.ir,
      mapped,
      options,
    );
  }

  // ── UPDATE / DELETE ──

  update(data: Record<string, unknown>): UpdateFinalizer<TModel> {
    this.sqb.operation = 'update';
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

  // ── terminal — go() is the only terminal ──

  /** Выполнить запрос и вернуть результат. */
  async go(): Promise<
    TMode extends 'first'
      ? (Evaluate<QueryResult<TModel, TSelect, TInclude>> | undefined)
      : Evaluate<QueryResult<TModel, TSelect, TInclude>>[]
  > {
    if (!this.sqb.selects) {
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
      const results = await this.adapter.execute(this.sqb);
      return this._isFirst ? (results[0] as any) : (results as any);
    }
    throw new Error('No adapter configured; cannot execute query.');
  }

  toSql(): string {
    if (!this.adapter)
      throw new Error(
        'No adapter configured. Import createDebugAdapter() from @karkardmitry/kadmium-sql-pg for SQL preview, or pass a PgAdapter for database access.',
      );
    const { text, values } = this.adapter.toSql(this.sqb);
    return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
  }

  // ── count / exists ──

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

  exists(): {
    go: () => Promise<boolean>;
    sql: () => string;
  } {
    this.limit(1);
    return {
      sql: () => this.toSql(),
      go: async (): Promise<boolean> => {
        const results = await this.go();
        return (results as any[]).length > 0;
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

  private _resolveIncludes(config: Record<string, any>): void {
    for (const [relationName, relationConfig] of Object.entries(config)) {
      const builder = this._createRelationByName(relationName);

      if (relationConfig === true) {
        this.sqb.includes.push(builder);
      } else if (
        typeof relationConfig === 'object' &&
        relationConfig !== null
      ) {
        if (relationConfig.alias) builder.as(relationConfig.alias);
        if (relationConfig.where) builder.where(relationConfig.where);
        if (relationConfig.order) builder.order(relationConfig.order);
        if (relationConfig.limit) builder.limit(relationConfig.limit);
        if (relationConfig.select) builder.select(relationConfig.select);
        this.sqb.includes.push(builder);
        if (relationConfig.include) {
          builder.include(relationConfig.include);
        }
      }
    }
  }

  private _createRelationByName(name: string): Relation {
    const fieldIr = this.ir.fields[name];
    const targetName = fieldIr?.sourceModel ?? fieldIr?.ref ?? name;
    const targetIr = this.irLookup(targetName) ?? {
      name: targetName,
      collection: toSnakeCase(targetName),
      fields: {},
    };
    return new Relation(
      this.sqb,
      name,
      targetIr,
      fieldIr,
      this.irLookup,
      this._alias(),
    );
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

  private _alias(): string {
    return [...this.sqb.tableContext.keys()][0] ?? this.ir.name;
  }
}
