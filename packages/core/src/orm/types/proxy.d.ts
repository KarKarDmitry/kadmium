import type { BaseFilter } from '../field-builders/base-filter';
import type {
  StringFilter,
  NumberFilter,
  BooleanFilter,
  DateFilter,
} from '../field-builders/filters';
import type { WhereExpression } from '../ast/where';
import type { SelectableField } from '../ast/selectable';
import type { AggregateField } from '../ast/aggregate';
import type {
  IncludeConfig,
  IncludeResult,
  FlatFinalResult,
  AnySelectable,
} from './includes';
import type { AggregateFunctions } from '../field-builders/aggregates';

export type NullableMethods = {
  readonly null: WhereCondition;
  readonly notNull: WhereCondition;
};

export type FieldTypeToFilter<TField> =
  NonNullable<TField> extends string
    ? StringFilter
    : NonNullable<TField> extends number
      ? NumberFilter
      : NonNullable<TField> extends boolean
        ? BooleanFilter
        : NonNullable<TField> extends Date
          ? DateFilter
          : BaseFilter;

type AddNullable<TField, TFilter> = undefined extends TField
  ? TFilter & NullableMethods
  : TFilter;

export type FilterProxy<
  TModel extends { ['~shape']: Record<string, unknown> },
> = {
  [K in keyof TModel['~shape']]-?: AddNullable<
    TModel['~shape'][K],
    FieldTypeToFilter<TModel['~shape'][K]>
  >;
};

export type SelectProxy<
  TModel extends { ['~shape']: Record<string, unknown> },
> = {
  [K in keyof TModel['~shape'] & string]-?: SelectableField<
    TModel['~shape'][K],
    K
  >;
};

/**
 * OrderDirection — готовое направление сортировки для ORDER BY.
 * Создаётся вызовом флага поля: `u.id.asc` / `u.id.desc`.
 */
export interface OrderDirection {
  readonly tableAlias: string;
  readonly fieldName: string;
  /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
  readonly column?: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * OrderField — флаг поля в OrderProxy. Сам по себе не направление:
 * обязателен вызов `.asc` / `.desc`, возвращающий OrderDirection.
 */
export interface OrderField {
  readonly tableAlias: string;
  readonly fieldName: string;
  /** Имя колонки в БД (FieldIR.alias ?? fieldName) */
  readonly column?: string;
  readonly asc: OrderDirection;
  readonly desc: OrderDirection;
}

export type OrderProxy<TModel extends { ['~shape']: Record<string, unknown> }> =
  {
    [K in keyof TModel['~shape'] & string]: OrderField;
  };

export type MultiOrderProxy<T extends AliasesMap> = {
  [TAlias in keyof T & string]: OrderProxy<
    InstanceType<T[TAlias]> extends { ['~shape']: Record<string, unknown> }
      ? InstanceType<T[TAlias]>
      : { ['~shape']: Record<string, never> }
  >;
};

// ── Having (HAVING) proxy ──

/**
 * HavingProxy — типизированный доступ к агрегатным алиасам из SELECT
 * для фильтрации групп (HAVING). Ключи — алиасы агрегатов (.as('cnt')).
 */
export type HavingProxy<S extends readonly any[]> = {
  [
    Sel in Extract<S[number], AggregateField<any>> as GetFieldName<Sel>
  ]: FieldTypeToFilter<GetFieldType<Sel>>;
};

/** SELECT-источник для HavingProxy: сам select либо пустой (`never`). */
export type HavingSource<T> = T extends readonly any[] ? T : never;

// ── Update/Delete finalizer ──

/** Finalizer for UPDATE/DELETE: .where(...).go() or .go() */
export interface UpdateFinalizer<
  TModel extends { ['~shape']: Record<string, unknown> },
> {
  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, aggregates: AggregateFunctions) => S,
  ): {
    go: () => Promise<FlatFinalResult<S>[]>;
    sql: () => string;
  };
  where(clause: (t: FilterProxy<TModel>) => WhereExpression | undefined): {
    returning<S extends readonly AnySelectable[]>(
      fn: (t: SelectProxy<TModel>, aggregates: AggregateFunctions) => S,
    ): {
      go: () => Promise<FlatFinalResult<S>[]>;
      sql: () => string;
    };
    go: () => Promise<TModel['~shape'][]>;
    sql: () => string;
  };
  go: () => Promise<TModel['~shape'][]>;
  sql: () => string;
}

// ── Multi-query types ──

export type AliasesMap = Record<
  string,
  {
    new (): {
      ['~shape']: Record<string, unknown>;
      ['~rel']: Record<string, unknown>;
      ['~relInfo']: Record<string, unknown>;
    };
  }
>;

export type MultiFilterProxy<T extends AliasesMap> = {
  [K in keyof T & string]: FilterProxy<
    InstanceType<T[K]> extends { ['~shape']: Record<string, unknown> }
      ? InstanceType<T[K]>
      : { ['~shape']: Record<string, never> }
  >;
};

export type MultiSelectProxy<T extends AliasesMap> = {
  [TAlias in keyof T & string]: {
    [
      TField in keyof (InstanceType<T[TAlias]> extends { ['~shape']: infer S }
        ? S
        : Record<never, never>) &
        string
    ]: SelectableField<
      (InstanceType<T[TAlias]> extends { ['~shape']: infer S }
        ? S
        : Record<never, never>)[TField],
      TField,
      undefined,
      TAlias
    >;
  };
};

export type MultiRelationProxy<T extends AliasesMap> = {
  [K in keyof T & string]: IncludeConfig<
    InstanceType<T[K]> extends {
      ['~shape']: Record<string, unknown>;
      ['~rel']: Record<string, unknown>;
      ['~relInfo']: Record<string, unknown>;
    }
      ? InstanceType<T[K]>
      : {
          ['~shape']: Record<string, never>;
          ['~rel']: Record<string, never>;
          ['~relInfo']: Record<string, never>;
        }
  >;
};

// ── Multi-query select result type ──

// ── Multi-query aggregate types ──

/** Extracts table alias from a selectable */
type GetTableAlias<S> =
  S extends SelectableField<any, any, any, infer TA> ? TA : never;

/** Union of all table aliases in a select array */
type AllTableAliases<S extends readonly any[]> = GetTableAlias<S[number]>;

/** Filter selectable fields that belong to a specific table alias */
type FieldsForAlias<S extends readonly any[], A extends string> = Extract<
  S[number],
  { tableAlias: A }
>;

/**
 * ObjectForAlias — строит объект для одного table alias.
 */
type ObjectForAlias<S extends readonly any[], A extends string> = {
  [
    Sel in FieldsForAlias<S, A> as Sel extends SelectableField<
      any,
      any,
      infer AL,
      any
    >
      ? AL extends string
        ? AL
        : Sel['fieldName'] & string
      : never
  ]: Sel extends SelectableField<infer T, any, any, any> ? T : never;
} extends infer O
  ? { [K in keyof O]: O[K] }
  : never;

/** Get the alias/field name from any selectable */
export type GetFieldName<S> =
  S extends AggregateField<any>
    ? S['alias'] extends string
      ? S['alias']
      : never
    : S extends SelectableField<any, any, infer AL, any>
      ? AL extends string
        ? AL
        : S['fieldName'] & string
      : never;

/** Get the result type from any selectable */
export type GetFieldType<S> =
  S extends AggregateField<infer T>
    ? T
    : S extends SelectableField<infer T, any, any, any>
      ? T
      : never;

/** Helper: получить тип модели по алиасу из T */
type ModelForAlias<T extends AliasesMap, A extends keyof T & string> =
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
      };

/**
 * FinalResult — для multi-запросов.
 * Каждый алиас из T → свой объект (поля из select + included relations).
 * Агрегаты → на верхнем уровне.
 */
export type FinalResult<
  S extends readonly any[],
  T extends AliasesMap,
  C extends { [A in keyof T & string]?: IncludeConfig<ModelForAlias<T, A>> } =
    Record<never, never>,
> = {
  [A in keyof T & string]: ObjectForAlias<S, A> &
    IncludeResult<
      ModelForAlias<T, A>,
      C extends { [K in A]: infer CC }
        ? CC extends IncludeConfig<ModelForAlias<T, A>>
          ? CC
          : Record<never, never>
        : Record<never, never>
    >;
} & {
  [
    Sel in Extract<S[number], AggregateField<any>> as GetFieldName<Sel>
  ]: GetFieldType<Sel>;
} extends infer R2
  ? { [K in keyof R2]: R2[K] }
  : never;

// ── RelationProxy — для include callback helper ──

export type RelationProxy<
  TModel extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
    ['~relInfo']: Record<string, unknown>;
  },
> = IncludeConfig<TModel>;
