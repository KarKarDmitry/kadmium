import { KadmiumSqb } from '../sqb';
import type { WhereCondition } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import { createFilter } from '../field-builders/factory';
import type { ModelIR } from '../../ir/index';
import type {
  FilterProxy,
  MultiFilterProxy,
  MultiSelectProxy,
  AliasesMap,
  FinalResult,
} from '../types/proxy';
import type { IncludeConfig } from '../types/includes';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { AggregateFunctions } from '../field-builders/aggregates';
import { aggregates } from '../field-builders/aggregates';
import type { AnySelectable } from '../types/includes';
import { addOrCondition } from './where-helpers';
import {
  buildRelation,
  configureRelation,
  type IncludeConfigValue,
} from './include-utils';

type MultiIncludeConfig<T extends AliasesMap> = {
  [A in keyof T & string]?: IncludeConfig<
    InstanceType<T[A]> extends {
      ['~shape']: Record<string, unknown>;
      ['~rel']: Record<string, unknown>;
      ['~relInfo']: Record<string, unknown>;
    }
      ? InstanceType<T[A]>
      : {
          ['~shape']: Record<string, never>;
          ['~rel']: Record<string, never>;
          ['~relInfo']: Record<string, never>;
        }
  >;
};

/**
 * MultiQueryBuilder — построитель многотабличных запросов.
 */
export class MultiQueryBuilder<
  T extends AliasesMap,
  TInclude extends MultiIncludeConfig<T> = Record<never, never>,
> {
  public sqb: KadmiumSqb;
  private irs: Map<string, ModelIR>;
  private irLookup: (name: string) => ModelIR | undefined;
  private adapter: SqlAdapter | null = null;

  constructor(
    irs: Map<string, ModelIR>,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.irs = irs;
    this.irLookup = irLookup ?? (() => undefined);
    this.adapter = adapter ?? null;
    this.sqb = new KadmiumSqb();

    for (const [alias, ir] of irs) {
      this.sqb.tableContext.set(alias, ir.collection);
    }
  }

  /** Копия билдера: независимый sqb, общие irs/adapter. */
  clone(): MultiQueryBuilder<T, TInclude> {
    const b = new MultiQueryBuilder<T, TInclude>(
      this.irs,
      this.irLookup,
      this.adapter ?? undefined,
    );
    b.sqb = this.sqb.clone();
    return b;
  }

  // ── where ──

  where(fn: (t: MultiFilterProxy<T>) => WhereCondition): this {
    this.sqb.wheres.conditions.push(fn(this._createFilterProxy()));
    return this;
  }

  and(fn: (t: MultiFilterProxy<T>) => WhereCondition): this {
    return this.where(fn);
  }

  or(fn: (t: MultiFilterProxy<T>) => WhereCondition): this {
    const condition = fn(this._createFilterProxy());
    addOrCondition(this.sqb.wheres, condition);
    return this;
  }

  // ── join ──

  join(options: {
    left: keyof T & string;
    right: keyof T & string;
    direction?: 'inner' | 'left' | 'right' | 'outer';
    on: (tables: MultiFilterProxy<T>) => WhereCondition;
  }): this {
    const onCondition = options.on(this._createFilterProxy());
    this.sqb.joins.push({
      left: options.left,
      right: options.right,
      direction: options.direction ?? 'inner',
      on: onCondition,
    });
    return this;
  }

  // ── select ──

  select<const S extends readonly AnySelectable[]>(
    fn: (t: MultiSelectProxy<T>, aggregates: AggregateFunctions) => S,
  ): {
    toSql(): string;
    go(): Promise<FinalResult<S, T, TInclude>[]>;
  } {
    const sqb = this.sqb.clone();
    sqb.selects = [...fn(this._createSelectProxy(), aggregates)];
    return {
      toSql: () => this._toSqlFrom(sqb),
      go: () => {
        if (this.adapter) {
          return this.adapter.execute(sqb) as any;
        }
        throw new Error('No adapter configured; cannot execute query.');
      },
    };
  }

  // ── include ──

  include<const C extends MultiIncludeConfig<T>>(
    config: C,
  ): MultiQueryBuilder<T, C> {
    this._resolveIncludes(config as Record<string, Record<string, any>>);
    return this as unknown as MultiQueryBuilder<T, C>;
  }

  // ── groupBy ──

  groupBy(fn: (t: MultiSelectProxy<T>) => SelectableField[]): this {
    const fields = fn(this._createSelectProxy());
    this.sqb.groupBy.push(...fields.map((f) => f.column ?? f.fieldName));
    return this;
  }

  // ── limit / offset / order ──

  limit(n: number): this {
    this.sqb.limit = n;
    return this;
  }

  offset(n: number): this {
    this.sqb.offset = n;
    return this;
  }

  order(
    fn: (t: MultiSelectProxy<T>) => SelectableField,
    dir: 'asc' | 'desc' = 'asc',
  ): this {
    const field = fn(this._createSelectProxy());
    this.sqb.orders.push({
      field: field.fieldName,
      column: field.column,
      direction: dir,
    });
    return this;
  }

  // ── toSql ──

  toSql(): string {
    return this._toSqlFrom(this.sqb.clone());
  }

  // ── private ──

  private _toSqlFrom(sqb: KadmiumSqb): string {
    if (!this.adapter)
      throw new Error(
        'No adapter configured. Import createDebugAdapter() from @karkardmitry/kadmium-sql-pg for SQL preview, or pass a PgAdapter for database access.',
      );
    const { text, values } = this.adapter.toSql(sqb);
    return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
  }

  private _resolveIncludes(
    config: Record<string, Record<string, IncludeConfigValue>>,
  ): void {
    for (const [alias, aliasConfig] of Object.entries(config)) {
      const modelIr = this.irs.get(alias);
      if (!modelIr || !aliasConfig || typeof aliasConfig !== 'object') continue;

      for (const [relationName, relationConfig] of Object.entries(
        aliasConfig,
      )) {
        const builder = buildRelation(
          this.sqb,
          modelIr,
          relationName,
          this.irLookup,
          alias,
        );
        configureRelation(this.sqb, builder, relationConfig);
      }
    }
  }

  private _createFilterProxy(): MultiFilterProxy<T> {
    const sqb = this.sqb;
    const irs = this.irs;
    return new Proxy({} as MultiFilterProxy<T>, {
      get: (_, alias: string) => {
        const ir = irs.get(alias);
        if (!ir) throw new Error(`Alias "${alias}" not found in query`);
        return new Proxy({} as FilterProxy<any>, {
          get: (__, field: string) => {
            const fieldIr = ir.fields[field];
            if (!fieldIr)
              throw new Error(`Field "${field}" not found in ${ir.name}`);
            return createFilter(sqb, field, alias, fieldIr);
          },
        });
      },
    });
  }

  private _createSelectProxy(): MultiSelectProxy<T> {
    const irs = this.irs;
    return new Proxy({} as MultiSelectProxy<T>, {
      get: (_, alias: string) => {
        const ir = irs.get(alias);
        return new Proxy({} as Record<string, SelectableField>, {
          get: (__, field: string) =>
            new SelectableField(
              alias,
              field,
              undefined,
              undefined,
              ir?.fields[field]?.alias,
            ),
        });
      },
    });
  }
}
