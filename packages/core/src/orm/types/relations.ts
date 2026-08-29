import type { WhereCondition } from '../ast/where';
import type { SelectableField } from '../ast/selectable';
import type { AggregateField } from '../ast/aggregate';
import type { FilterProxy, OrderField, OrderProxy, SelectProxy } from './proxy';
import type { IRelationBuilder } from '../field-builders/relation';

// ── Relation type helpers ──

export type ToOneRelation<T> = T;
export type ToManyRelation<T> = T[];

export type RelationsOf<T> = T extends { ['~rel']: infer R } ? R : never;
export type ShapeOf<T> = T extends { ['~shape']: infer S } ? S : never;

// ── Utility types ──

/** Форсирует eager evaluation — IDE показывает конкретный объект, а не generic */
export type Evaluate<T> = { [K in keyof T]: T[K] } & {};

export type UnionToIntersection<U> = (
  U extends any ? (x: U) => any : never
) extends (x: infer I) => any
  ? I
  : never;

// ── Selectable type helpers ──

/** Извлекает имя поля: alias если есть, иначе fieldName */
type GetFieldName<S> =
  S extends AggregateField<any>
    ? S['alias'] extends string
      ? S['alias']
      : never
    : S extends SelectableField<any, any, infer A>
      ? A extends string
        ? A
        : S['fieldName'] & string
      : never;

/** Извлекает TS-тип поля из phantom-параметра (SelectableField или AggregateField) */
type GetFieldType<S> =
  S extends AggregateField<infer T>
    ? T
    : S extends SelectableField<infer T, any, any>
      ? T
      : unknown;

export type AnySelectable =
  SelectableField<any, any, any> | AggregateField<any>;

/**
 * FlatFinalResult — строит плоский объект из кортежа SelectableField.
 * Пример: [SelectableField<number, 'id'>, SelectableField<string, 'title'>]
 *   → { id: number; title: string }
 */
/**
 * FlatFinalResult — строит плоский объект из кортежа SelectableField.
 * Итерируется по T[number] (union элементов), дистрибутивно маппит каждый.
 * Пример: [SelectableField<number, 'post_id'>, SelectableField<string, undefined>]
 *   T[number] = SelectableField<number, 'post_id'> | SelectableField<string, undefined>
 *   → { post_id: number; title: string }
 */
export type FlatFinalResult<S extends readonly any[]> = {
  [E in S[number] as GetFieldName<E>]: GetFieldType<E>;
};

/**
 * Extract the included type from a relation builder.
 * If the builder has explicit _selects (non-never, non-empty tuple), use those;
 * otherwise use the full shape.
 */
type GetIncludedType<R, RelatedModel> = R extends { _selects: infer S }
  ? [S] extends [never]
    ? ShapeOf<RelatedModel>
    : S extends readonly [any, ...any[]]
      ? FlatFinalResult<S>
      : ShapeOf<RelatedModel>
  : ShapeOf<RelatedModel>;

/**
 * Process a single relation-builder tuple element into an intersection-friendly object.
 */
type ProcessRelation<T, R> = R extends {
  originalName: infer TName extends string;
  alias: infer TAlias extends string;
  __nested?: infer TNested;
}
  ? TName extends keyof RelationsOf<T>
    ? NonNullable<RelationsOf<T>[TName]> extends ToOneRelation<
        infer RelatedModel extends { ['~shape']: Record<string, unknown> }
      >
      ? {
          [K in TAlias]:
            | (GetIncludedType<R, RelatedModel> &
                (TNested extends readonly [any, ...any[]]
                  ? BuildIncludedResultRecur<RelatedModel, TNested>
                  : {}))
            | (TName extends keyof ShapeOf<T>
                ? undefined extends ShapeOf<T>[TName]
                  ? undefined
                  : never
                : undefined);
        }
      : NonNullable<RelationsOf<T>[TName]> extends ToManyRelation<
            infer RelatedModel extends { ['~shape']: Record<string, unknown> }
          >
        ? {
            [K in TAlias]: (GetIncludedType<R, RelatedModel> &
              (TNested extends readonly [any, ...any[]]
                ? BuildIncludedResultRecur<RelatedModel, TNested>
                : {}))[];
          }
        : never
    : never
  : never;

/**
 * Recursive accumulator: processes each relation builder in the tuple and
 * builds a union-to-intersection of all relation result objects.
 */
type BuildIncludedResultRecur<
  T,
  R,
  Acc extends readonly object[] = [],
> = R extends readonly [infer First, ...infer Rest]
  ? BuildIncludedResultRecur<T, Rest, [...Acc, ProcessRelation<T, First>]>
  : Acc['length'] extends 0
    ? {}
    : UnionToIntersection<Acc[number]>;

/**
 * Build the included result object from a tuple of IRelationBuilder.
 */
export type BuildIncludedResult<T, R> = BuildIncludedResultRecur<T, R>;

/**
 * Final result type when no explicit select() is given:
 * the model shape merged with all included relations.
 *
 * Использует Omit, чтобы поля из ~rel (связи) вытесняли поля из ~shape (FK).
 * Например: ~shape = { author: number }, ~rel = { author?: User }.
 *  → IncludeResult = { author?: User } (number вытеснено).
 */
export type IncludeResult<T, R> = Omit<
  ShapeOf<T>,
  keyof BuildIncludedResult<T, R>
> &
  BuildIncludedResult<T, R>;

// ── Query finalizer interfaces ──

export interface ISingleTableQuery<
  T extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  },
  R extends readonly IRelationBuilder<any, any, any, any, any>[],
  TResult,
> {
  where(
    clause: (t: FilterProxy<T>) => WhereCondition,
  ): ISingleTableQuery<T, R, TResult>;
  and(
    clause: (t: FilterProxy<T>) => WhereCondition,
  ): ISingleTableQuery<T, R, TResult>;
  or(
    clause: (t: FilterProxy<T>) => WhereCondition,
  ): ISingleTableQuery<T, R, TResult>;
  group(
    callback: (q: ISingleTableQuery<T, R, TResult>) => void,
  ): ISingleTableQuery<T, R, TResult>;
  order(
    fn: (t: OrderProxy<T>) => OrderField,
    dir?: 'asc' | 'desc',
  ): ISingleTableQuery<T, R, TResult>;
  limit(n: number): ISingleTableQuery<T, R, TResult>;
  offset(n: number): ISingleTableQuery<T, R, TResult>;
  page(p: number, size: number): ISingleTableQuery<T, R, TResult>;
  groupBy(
    fn: (t: SelectProxy<T>) => SelectableField[],
  ): ISingleTableQuery<T, R, TResult>;
  toSql(): string;
  go(): Promise<TResult[]>;
}

export interface IFirstQuery<
  T extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  },
  R extends readonly IRelationBuilder<any, any, any, any, any>[],
  TResult,
> {
  toSql(): string;
  go(): Promise<TResult | undefined>;
}
