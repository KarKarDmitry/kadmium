import { type AnySelectableField } from '../sqb';
import type { WhereExpression } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import { createFilter } from '../field-builders/factory';
import { createOrderProxy } from './query-proxies';
import { BaseQueryBuilder } from './base-query-builder';
import { toSqlCondition, type SqlFragment } from '../sql-fragment';
import type { ModelIR } from '../../ir/index';
import type {
  MultiFilterProxy,
  MultiSelectProxy,
  MultiOrderProxy,
  AliasesMap,
  FinalResult,
  SelectTools,
} from '../types/proxy';
import type { IncludeConfig } from '../types/includes';
import type {
  CompiledQuery,
  HoleRef,
  SqlAdapter,
} from '@karkardmitry/kadmium-sql-types';
import { aggregates } from '../field-builders/aggregates';
import { windowFunctions } from '../field-builders/window-functions';
import type { AnySelectable } from '../types/includes';
import type { AnyFilterProxy } from '../types/phantom';
import type { AnyArrayField } from '../ast/array-field';
import type { MultiQuerySlots, ToDef } from '../query-slots';
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
 * MultiSelectResult — терминал multi-запроса (select финализирует цепочку).
 * compile() компилирует снaпшот: плоский путь — тип слотов руками
 * (compile<T>()), типизированный — runtime-проверка имён через
 * MultiQuerySlots.assertSlotNames. TResult — миррор go() (всегда массив).
 */
export interface MultiSelectResult<
  S extends readonly AnySelectable[],
  T extends AliasesMap,
  C extends MultiIncludeConfig<T> = Record<never, never>,
> {
  /**
   * @deprecated Используйте `.compile()` — он возвращает CompiledQuery с
   *   .text/.values/.slotOrder; SQL-preview для дебага — `.compile().sql()`.
   */
  toSql(): string;
  go(): Promise<FinalResult<S, T, C>[]>;
  compile<
    TSlots extends Record<string, unknown> = Record<string, never>,
  >(): CompiledQuery<TSlots, FinalResult<S, T, C>[]>;
  compile<NS extends readonly (AnySelectable | AnyArrayField)[]>(
    slots: MultiQuerySlots<T, NS>,
  ): CompiledQuery<ToDef<NS>, FinalResult<S, T, C>[]>;
}

/**
 * MultiQueryBuilder — построитель многотабличных запросов.
 */
export class MultiQueryBuilder<
  T extends AliasesMap,
  TInclude extends MultiIncludeConfig<T> = Record<never, never>,
> extends BaseQueryBuilder<
  MultiFilterProxy<T>,
  MultiSelectProxy<T>,
  MultiOrderProxy<T>
> {
  private irs: Map<string, ModelIR>;

  constructor(
    irs: Map<string, ModelIR>,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    super(irLookup, adapter);
    this.irs = irs;
    this.sqb.isMulti = true;

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

  // ── join ──

  join(options: {
    left: keyof T & string;
    right: keyof T & string;
    direction?: 'inner' | 'left' | 'right' | 'outer';
    on: (
      tables: MultiFilterProxy<T>,
    ) => WhereExpression | SqlFragment | undefined;
  }): this {
    const direction = options.direction ?? 'inner';
    // Дубликат пары (left, right, direction) в АСТ не добавляем (C11)
    const dupe = (j: (typeof this.sqb.joins)[number]) =>
      j.left === options.left &&
      j.right === options.right &&
      j.direction === direction;
    if (!this.sqb.joins.some(dupe)) {
      const rawOn = options.on(this._createFilterProxy());
      if (rawOn === undefined)
        throw new Error(
          `join.on: empty expression for ${options.left}↔${options.right} — provide a condition`,
        );
      const onCondition = toSqlCondition(rawOn);
      this.sqb.joins.push({
        left: options.left,
        right: options.right,
        direction,
        on: onCondition,
      });
    }
    return this;
  }

  // ── select ──

  select<const S extends readonly AnySelectable[]>(
    fn: (t: MultiSelectProxy<T>, tools: SelectTools) => S,
  ): MultiSelectResult<S, T, TInclude>;
  select<const S extends readonly AnySelectable[]>(
    items: S,
  ): MultiSelectResult<S, T, TInclude>;
  select<const S extends AnySelectable>(
    item: S,
  ): MultiSelectResult<[S], T, TInclude>;
  select(
    source:
      | ((
          t: MultiSelectProxy<T>,
          tools: SelectTools,
        ) => readonly AnySelectable[])
      | readonly AnySelectable[]
      | AnySelectable,
  ): MultiSelectResult<readonly AnySelectable[], T, TInclude> {
    const sqb = this.sqb.clone();
    const items =
      typeof source === 'function'
        ? source(this._createSelectProxy(), {
            agg: aggregates,
            wf: windowFunctions,
          })
        : Array.isArray(source)
          ? source
          : [source];
    sqb.selects = [...items] as AnySelectableField[];
    const result: MultiSelectResult<readonly AnySelectable[], T, TInclude> = {
      toSql: () => this._toSqlFrom(sqb),
      go: () => {
        if (this.adapter) {
          return this.adapter.execute(sqb) as Promise<
            FinalResult<readonly AnySelectable[], T, TInclude>[]
          >;
        }
        throw new Error('No adapter configured; cannot execute query.');
      },
      compile: (slots?: MultiQuerySlots<T, any>) => {
        const snap = sqb.clone();
        if (!this.adapter)
          throw new Error('No adapter configured; cannot compile SQL.');
        const { text, values, slotOrder } = this.adapter.toSql(snap);
        slots?.assertSlotNames(slotOrder ?? []);
        return {
          text,
          values: values as (unknown | HoleRef)[],
          slotOrder: slotOrder ?? [],
          single: false,
          sqb: snap,
        } as unknown as CompiledQuery<any, any>;
      },
    };
    return result;
  }

  // ── include ──

  include<const C extends MultiIncludeConfig<T>>(
    config: C,
  ): MultiQueryBuilder<T, C> {
    this._resolveIncludes(
      config as Record<string, Record<string, IncludeConfigValue>>,
    );
    return this as unknown as MultiQueryBuilder<T, C>;
  }

  // ── private ──

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

  protected _fallbackAlias(): string {
    return Object.keys(this.irs)[0] ?? '';
  }

  protected _createFilterProxy(): MultiFilterProxy<T> {
    const sqb = this.sqb;
    const irs = this.irs;
    return new Proxy({} as MultiFilterProxy<T>, {
      get: (_, alias: string) => {
        const ir = irs.get(alias);
        if (!ir) throw new Error(`Alias "${alias}" not found in query`);
        return new Proxy({} as AnyFilterProxy, {
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

  protected _createSelectProxy(): MultiSelectProxy<T> {
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

  protected _createOrderProxy(): MultiOrderProxy<T> {
    const irs = this.irs;
    return new Proxy({} as MultiOrderProxy<T>, {
      get: (_, alias: string) =>
        createOrderProxy(
          alias,
          irs.get(alias) ?? {
            name: alias,
            collection: alias,
            fields: {},
          },
        ),
    });
  }
}
