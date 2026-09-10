import type { WhereExpression } from '../ast/where';
import type { SelectableField } from '../ast/selectable';
import type { AggregateField } from '../ast/aggregate';
import type { OrderDirection, GetFieldName, GetFieldType } from './proxy';
import type { Evaluate } from './relations';

// ── Helper types ──

/** Извлечь target model из ~relInfo */
type RelTarget<M, K extends string> = M extends {
  ['~relInfo']: Record<K, { target: infer T }>;
}
  ? T
  : never;

/** Извлечь kind из ~relInfo */
type RelKind<M, K extends string> = M extends {
  ['~relInfo']: Record<K, { kind: infer K2 }>;
}
  ? K2
  : never;

/** RelationsOf — имена relations из ~rel */
export type RelationsOf<T> = T extends { ['~rel']: infer R } ? R : never;

/** ShapeOf — shape из ~shape */
export type ShapeOf<T> = T extends { ['~shape']: infer S } ? S : never;

/** Shape of the target model for a relation */
type TargetShape<M, K extends string> = ShapeOf<RelTarget<M, K>>;

/** Определить result type relation: array или single */
type RelationResult<M, K extends string> =
  RelKind<M, K> extends 'one-to-many'
    ? TargetShape<M, K>[]
    : RelKind<M, K> extends 'one-to-one'
      ? TargetShape<M, K> | undefined
      : RelKind<M, K> extends 'many-to-one'
        ? TargetShape<M, K>
        : TargetShape<M, K>;

// ── Selectable type helpers ──

/** Канон GetFieldName/GetFieldType — в proxy.d.ts */
export type { GetFieldName, GetFieldType } from './proxy';

export type AnySelectable =
  SelectableField<any, any, any> | AggregateField<any>;

/** AllFields — маркер: select не вызван, берём все поля модели */
export type AllFields = { readonly '~allFields': true };

/**
 * FlatFinalResult — строит плоский объект из кортежа SelectableField.
 * Пример: [SelectableField<number, 'id'>, SelectableField<string, 'title'>]
 *   → { id: number; title: string }
 */
export type FlatFinalResult<S extends readonly any[]> = {
  [E in S[number] as GetFieldName<E>]: GetFieldType<E>;
};

/** Извлечь return type select callback */
type ExtractSelectResult<C> = C extends { select: (t: any) => infer R }
  ? R
  : never;

// ── Include Config ──

/** Proxy для select callback внутри include */
type IncludeSelectProxy<T> = {
  [
    K in T extends { ['~shape']: infer S } ? keyof S & string : never
  ]: SelectableField<
    T extends { ['~shape']: infer S } ? S[K & keyof S] : never,
    K
  >;
};

/** Proxy для where/order callback внутри include */
type IncludeFilterProxy<T> = {
  [K in T extends { ['~shape']: infer S } ? keyof S & string : never]: any;
};

/**
 * Конфиг одного relation. Options едины для to-one и to-many —
 * рантайм (`_buildInclude`) применяет select/where/order/limit для обоих.
 */
type IncludeRelationConfig<M, K extends string> =
  | true
  | {
      alias?: string;
      select?: (
        t: IncludeSelectProxy<RelTarget<M, K>>,
      ) => readonly AnySelectable[];
      where?: (
        t: IncludeFilterProxy<RelTarget<M, K>>,
      ) => WhereExpression | undefined;
      order?: (t: IncludeFilterProxy<RelTarget<M, K>>) => OrderDirection[];
      limit?: number;
      include?: IncludeConfig<RelTarget<M, K>>;
    };

/** Полный include config */
export type IncludeConfig<M> = {
  [
    K in M extends { ['~relInfo']: infer R } ? keyof R & string : never
  ]?: IncludeRelationConfig<M, K & string>;
};

// ── Result Computation ──

/**
 * Include-ключи перекрывают поля базового shape/FK (рантайм их замещает:
 * many-to-one relation пишется в тот же ключ, где был number FK).
 */
type WithIncludes<Base, Included> = Evaluate<
  Omit<Base, keyof Included> & Included
>;

/** Вычислить тип одного relation по config */
type ResolveRelation<M, K extends string, C> = C extends true
  ? RelationResult<M, K>
  : C extends { select: infer S; include: infer Nested }
    ? RelKind<M, K> extends 'one-to-many'
      ? WithIncludes<
          FlatFinalResult<ExtractSelectResult<C>>,
          ResolveIncludes<RelTarget<M, K>, Nested>
        >[]
      : WithIncludes<
          FlatFinalResult<ExtractSelectResult<C>>,
          ResolveIncludes<RelTarget<M, K>, Nested>
        >
    : C extends { select: infer S }
      ? RelKind<M, K> extends 'one-to-many'
        ? Evaluate<FlatFinalResult<ExtractSelectResult<C>>>[]
        : Evaluate<FlatFinalResult<ExtractSelectResult<C>>>
      : C extends { include: infer Nested }
        ? RelKind<M, K> extends 'one-to-many'
          ? WithIncludes<
              TargetShape<M, K>,
              ResolveIncludes<RelTarget<M, K>, Nested>
            >[]
          : WithIncludes<
              TargetShape<M, K>,
              ResolveIncludes<RelTarget<M, K>, Nested>
            >
        : RelationResult<M, K>;

/** Вычислить вложенные include (two-pass: raw keys → alias remap) */
type ResolveIncludes<M, C> =
  C extends Record<string, any>
    ? Evaluate<
        RemapIncludeAliases<
          {
            [
              K in keyof C &
                keyof (M extends { ['~relInfo']: infer R }
                  ? R
                  : Record<never, never>)
            ]: ResolveRelation<M, K & string, C[K]>;
          },
          C
        >
      >
    : Record<never, never>;

/** Remap keys of raw include result using alias from config.
 *  Separated so C is concrete when the as clause evaluates. */
type RemapIncludeAliases<Raw, C> = {
  [
    K in keyof Raw as K extends string
      ? C extends Record<K, { alias: infer A extends string }>
        ? A
        : K
      : never
  ]: Raw[K];
};

/** Финальный result type из include config (без select) */
export type IncludeResult<M, C> = WithIncludes<
  ShapeOf<M>,
  ResolveIncludes<M, C>
>;

/**
 * QueryResult — вычисляемый result type для go().
 * S = AllFields → все поля модели + includes.
 * S = tuple → только выбранные поля + includes.
 */
export type QueryResult<M, S, C> = S extends AllFields
  ? IncludeResult<M, C>
  : S extends readonly AnySelectable[]
    ? WithIncludes<FlatFinalResult<S>, ResolveIncludes<M, C>>
    : IncludeResult<M, C>;
