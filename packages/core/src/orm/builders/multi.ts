import { KadmiumSqb } from '../sqb';
import type { WhereCondition, WhereGroup } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import { createFilter } from '../field-builders/factory';
import type { ModelIR } from '../../ir/index';
import { toSnakeCase } from '../../ir/index';
import type {
  FilterProxy,
  MultiFilterProxy,
  MultiSelectProxy,
  MultiRelationProxy,
  AliasesMap,
  FinalResult,
} from '../types/proxy';
import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { AggregateFunctions } from '../field-builders/aggregates';
import { aggregates } from '../field-builders/aggregates';
import type { AnySelectable } from '../types/relations';
import {
  RelationBuilder,
  ToOneRelationBuilder,
  ToManyRelationBuilder,
  type IRelationBuilder,
} from '../field-builders/relation';

/**
 * MultiQueryBuilder — построитель многотабличных запросов.
 *
 * Использование:
 *   app.orm.query({ u: User, p: Post })
 *     .join({ left: 'u', right: 'p', on: (t) => t.u.id.eq(t.p.author_id) })
 *     .where((t) => t.u.name.eq('Alice'))
 *     .select((t) => [t.u.name, t.p.title])
 *     .go()
 */
export class MultiQueryBuilder<
  T extends AliasesMap,
  R extends readonly IRelationBuilder<any, any, any, any, any>[] = [],
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

    // Регистрируем все таблицы в контексте
    for (const [alias, ir] of irs) {
      this.sqb.tableContext.set(alias, ir.collection);
    }
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
    this._or(condition);
    return this;
  }

  private _or(condition: WhereCondition): void {
    if (this.sqb.wheres.conditions.length === 0) {
      this.sqb.wheres.conditions.push(condition);
      return;
    }
    if (this.sqb.wheres.op === 'OR') {
      this.sqb.wheres.conditions.push(condition);
      return;
    }
    if (this.sqb.wheres.conditions.length === 1) {
      this.sqb.wheres.op = 'OR';
      this.sqb.wheres.conditions.push(condition);
    } else {
      const prev: WhereGroup = {
        op: this.sqb.wheres.op,
        conditions: [...this.sqb.wheres.conditions],
      };
      this.sqb.wheres.op = 'OR';
      this.sqb.wheres.conditions = [prev, condition];
    }
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
    go(): Promise<FinalResult<S, T, R>[]>;
  } {
    this.sqb.selects = [...fn(this._createSelectProxy(), aggregates)];
    return {
      toSql: () => this.toSql(),
      go: () => {
        if (this.adapter) {
          return this.adapter.execute(this.sqb) as any;
        }
        throw new Error('No adapter configured; cannot execute query.');
      },
    };
  }

  // ── include ──

  include<
    const R2 extends readonly IRelationBuilder<any, any, any, any, any>[],
  >(
    selector: (relations: MultiRelationProxy<T>) => R2,
  ): MultiQueryBuilder<T, [...R, ...R2]> {
    const builders = selector(this._createRelationProxy());
    for (const builder of builders) {
      const parentAlias = (builder as any).parentAlias as string;
      const parentIr = this.irs.get(parentAlias);
      if (!parentIr) throw new Error(`Alias "${parentAlias}" not found`);
      const fieldIr = parentIr.fields[builder.originalName];
      this.sqb.includes.push(
        (builder as any).resolveInclude(parentAlias, fieldIr),
      );
    }
    return this as unknown as MultiQueryBuilder<T, [...R, ...R2]>;
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
    if (!this.adapter)
      throw new Error(
        'No SQL adapter configured. Use .go() only with an adapter.',
      );
    const { text, values } = this.adapter.toSql(this.sqb);
    return `SQL: ${text}\nVALUES: [${values.join(', ')}]`;
  }

  // ── private ──

  private _createFilterProxy(): MultiFilterProxy<T> {
    const sqb = this.sqb;
    const irs = this.irs;
    const lookup = this.irLookup;
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

  private _createRelationProxy(): MultiRelationProxy<T> {
    const sqb = this.sqb;
    const irs = this.irs;
    const lookup = this.irLookup;
    return new Proxy({} as MultiRelationProxy<T>, {
      get: (_, alias: string) => {
        const ir = irs.get(alias);
        if (!ir) throw new Error(`Alias "${alias}" not found`);
        return new Proxy({} as Record<string, RelationBuilder>, {
          get: (__, name: string) => {
            const fieldIr = ir.fields[name];
            if (!fieldIr || fieldIr.type !== 'ref')
              throw new Error(`Relation "${name}" not found in ${ir.name}`);
            const targetName = fieldIr.sourceModel ?? fieldIr.ref ?? name;
            const targetIr: ModelIR = lookup?.(targetName) ?? {
              name: targetName,
              collection: toSnakeCase(targetName),
              fields: {},
            };
            const isToMany =
              !!fieldIr.sourceModel && fieldIr.relation === 'one-to-many';
            const builder = isToMany
              ? new ToManyRelationBuilder(
                  sqb,
                  name,
                  targetIr,
                  undefined,
                  lookup,
                  alias as any,
                )
              : new ToOneRelationBuilder(
                  sqb,
                  name,
                  targetIr,
                  undefined,
                  lookup,
                  alias as any,
                );
            return builder;
          },
        });
      },
    }) as MultiRelationProxy<T>;
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
