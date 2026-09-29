import type { CursorWhereExpression, WhereExpression } from '../ast/where';
import type { SelectableField } from '../ast/selectable';
import type { SqlFragment, SqlOrder } from '../sql-fragment';
import type { AnyArrayField } from '../ast/array-field';
import type { CompiledQuery } from '@karkardmitry/kadmium-sql-types';
import type { QuerySlots, ToDef } from '../query-slots';
import type {
  AllFields,
  AnySelectable,
  IncludeConfig,
  QueryResult,
} from '../types/includes';
import type { Evaluate } from '../types/relations';
import type {
  FilterProxy,
  SelectProxy,
  OrderProxy,
  HavingProxy,
  HavingSource,
  SelectTools,
  OrderDirection,
  UpdateFinalizer,
  MultiFilterProxy,
  MultiSelectProxy,
  MultiOrderProxy,
  AliasesMap,
} from '../types/proxy';
import type { KadmiumSqb } from '../sqb';
import type { DmlData, SqlPreviewTerminal } from './single';
import type {
  MultiIncludeConfig,
  MultiFirstResult,
  MultiSelectResult,
} from './multi';
import type {
  CreateFinalizer,
  CreateManyFinalizer,
  CreateManyOptions,
} from './upsert-helpers';
/** * Handle-поверхность ORM-билдеров (План 2, шаг 2). * * Публичные типы-ветки поверх приватных SingleQueryBuilder/MultiQueryBuilder. * Каждая ветка разрешает только те шаги, которые корректны в своём состоянии, * — проблемные порядки ловятся на типах, а не рантаймом: * *   SingleConfigHandle   — вход single(): нет cursor() (он требует order()). *   SingleOrderingBranch — после order(): cursor() доступен; offset()/page() *                          перебрасывают в конфиг-ветку (теряется курсор). *   SingleCursorBranch   — после cursor(): offset()/page()/cursor() недоступны; *                          order() мутирует тот же объект и остаётся в ветке. *   MultiConfigHandle    — единственная ветка multi: разрешено всё. * * Ограничение: ветки — это тот же объект (мутация in place), типы ничего не * накладывают на рантайм: runtime-гарды остаются источником истины * (defense-in-depth). Классы НЕ реализуют интерфейсы — типы this-возвратов * запрещены в implements-клаузе (TS2476), переходы локализованы в single.ts * через `return this as unknown as XHandle<...>`. * * Ветки single параметризуются состоянием напрямую (M/S/I/Mo — зеркало * generic-параметров SingleQueryBuilder), без accessor-типов MOf/SOf/... : * пере-инстанциация ветки с изменённым S (select/first) через манглинг * `WithSelect<B, S>` валила TS в бесконечную рекурсию (типы this-возвратов + * оверлоады select в общей базе), поэтому взята та же схема, что у класса. */ /** Контракт модели, как у SingleQueryBuilder (shape/rel/relInfo). */ type Shape =
  {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
    ['~relInfo']: Record<string, unknown>;
  };
type Mode = 'many' | 'first';
/** Результат go()/compile() для single — зеркало SingleQueryBuilder.go(). */ type SingleResult<
  M,
  S,
  I,
  Mo extends Mode,
> = Mo extends 'first'
  ? Evaluate<QueryResult<M, S, I>> | undefined
  : Evaluate<QueryResult<M, S, I>>[];
/** * SingleShared — методы, нейтральные к single-состоянию: вернут `this` — * текущую ветку. Полиморфный this на типе-значении разрешается в ту ветку, * на которой метод вызван, поэтому cursor не «протекает» из OrderingBranch * в конфиг, а where/limit остаются на всех ветках. */ export interface SingleShared<
  M extends Shape,
  S,
  I,
  Mo extends Mode,
> {
  /** Текущий снапшот запроса (тестовый/дебаг-доступ к AST). */ readonly sqb: KadmiumSqb;
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
  groupBy(
    fn: (t: SelectProxy<M>) => ReadonlyArray<SelectableField | SqlFragment>,
  ): this;
  limit(n: number): this;
  /** Копия билдера: независимый sqb, общие ir/adapter. */ clone(): this;
  /** Выполнить запрос и вернуть результат. */ go(): Promise<
    SingleResult<M, S, I, Mo>
  >;
  /** Терминал компиляции — плоский путь (тип слотов руками). */ compile<
    T extends Record<string, unknown> = Record<string, never>,
  >(): CompiledQuery<T, SingleResult<M, S, I, Mo>>;
  /** Терминал компиляции — типизированные слоты. */ compile<
    NS extends readonly (AnySelectable | AnyArrayField)[],
  >(
    slots: QuerySlots<M, NS>,
  ): CompiledQuery<ToDef<NS>, SingleResult<M, S, I, Mo>>;
  /** Терминал count() с SQL-превью. */ count(): SqlPreviewTerminal<number>;
  /** Терминал exists() с SQL-превью. */ exists(): SqlPreviewTerminal<boolean>;
  /** @deprecated Используйте `.compile()`; SQL-preview — `.compile().sql()`. */ toSql(): string;
  create(data: DmlData<M>): CreateFinalizer<M>;
  createMany(
    data: Record<string, unknown>[],
    options?: CreateManyOptions,
  ): CreateManyFinalizer<M>;
  update(data: DmlData<M>): UpdateFinalizer<M>;
  delete(): UpdateFinalizer<M>;
}
/** * SingleConfigHandle — входной тип single(): cursor() недоступен до order(). * order() уводит в SingleOrderingBranch; offset()/page() остаются в конфиге. */ export interface SingleConfigHandle<
  M extends Shape,
  S = AllFields, // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  I = {},
  Mo extends Mode = 'many',
> extends SingleShared<M, S, I, Mo> {
  select(): SingleConfigHandle<M, AllFields, I, Mo>;
  select<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SingleConfigHandle<M, NS, I, Mo>;
  select<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SingleConfigHandle<M, NS, I, Mo>;
  select<NS extends AnySelectable>(
    item: NS,
  ): SingleConfigHandle<M, [NS], I, Mo>;
  include<const C extends IncludeConfig<M>>(
    config: C,
  ): SingleConfigHandle<M, S, C, Mo>;
  first(): SingleConfigHandle<M, S, I, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SingleConfigHandle<M, NS, I, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SingleConfigHandle<M, NS, I, 'first'>;
  first<NS extends AnySelectable>(
    item: NS,
  ): SingleConfigHandle<M, [NS], I, 'first'>;
  findById(id: M['~shape']['id']): SingleConfigHandle<M, S, I, 'first'>;
  order(
    fn: (t: OrderProxy<M>) => (OrderDirection | SqlOrder<'asc' | 'desc'>)[],
  ): SingleOrderingBranch<M, S, I, Mo>;
  offset(n: number): SingleConfigHandle<M, S, I, Mo>;
  page(page: number, size: number): SingleConfigHandle<M, S, I, Mo>;
}
/** * SingleOrderingBranch — после order(): cursor() доступен. * offset()/page() «разоружают» ветку в SingleConfigHandle: порядок остаётся, * но курсор/ключ больше не появятся на типе. */ export interface SingleOrderingBranch<
  M extends Shape,
  S = AllFields, // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  I = {},
  Mo extends Mode = 'many',
> extends SingleShared<M, S, I, Mo> {
  select(): SingleOrderingBranch<M, AllFields, I, Mo>;
  select<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SingleOrderingBranch<M, NS, I, Mo>;
  select<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SingleOrderingBranch<M, NS, I, Mo>;
  select<NS extends AnySelectable>(
    item: NS,
  ): SingleOrderingBranch<M, [NS], I, Mo>;
  include<const C extends IncludeConfig<M>>(
    config: C,
  ): SingleOrderingBranch<M, S, C, Mo>;
  first(): SingleOrderingBranch<M, S, I, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SingleOrderingBranch<M, NS, I, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SingleOrderingBranch<M, NS, I, 'first'>;
  first<NS extends AnySelectable>(
    item: NS,
  ): SingleOrderingBranch<M, [NS], I, 'first'>;
  findById(id: M['~shape']['id']): SingleOrderingBranch<M, S, I, 'first'>;
  order(
    fn: (t: OrderProxy<M>) => (OrderDirection | SqlOrder<'asc' | 'desc'>)[],
  ): SingleOrderingBranch<M, S, I, Mo>;
  offset(n: number): SingleConfigHandle<M, S, I, Mo>;
  page(page: number, size: number): SingleConfigHandle<M, S, I, Mo>;
  cursor(
    fn: (t: FilterProxy<M>) => CursorWhereExpression | undefined,
  ): SingleCursorBranch<M, S, I, Mo>;
}
/** * SingleCursorBranch — после cursor(): offset()/page()/cursor() недоступны; * order() мутирует тот же объект и остаётся в ветке. */ export interface SingleCursorBranch<
  M extends Shape,
  S = AllFields, // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  I = {},
  Mo extends Mode = 'many',
> extends SingleShared<M, S, I, Mo> {
  select(): SingleCursorBranch<M, AllFields, I, Mo>;
  select<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SingleCursorBranch<M, NS, I, Mo>;
  select<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SingleCursorBranch<M, NS, I, Mo>;
  select<NS extends AnySelectable>(
    item: NS,
  ): SingleCursorBranch<M, [NS], I, Mo>;
  include<const C extends IncludeConfig<M>>(
    config: C,
  ): SingleCursorBranch<M, S, C, Mo>;
  first(): SingleCursorBranch<M, S, I, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<M>, tools: SelectTools) => NS,
  ): SingleCursorBranch<M, NS, I, 'first'>;
  first<NS extends readonly AnySelectable[]>(
    items: NS,
  ): SingleCursorBranch<M, NS, I, 'first'>;
  first<NS extends AnySelectable>(
    item: NS,
  ): SingleCursorBranch<M, [NS], I, 'first'>;
  findById(id: M['~shape']['id']): SingleCursorBranch<M, S, I, 'first'>;
  order(
    fn: (t: OrderProxy<M>) => (OrderDirection | SqlOrder<'asc' | 'desc'>)[],
  ): SingleCursorBranch<M, S, I, Mo>;
}
/** * MultiConfigHandle — единственная ветка multi. select() — терминал * (MultiSelectResult), count/exists/first приходят в плане 3. */ export interface MultiConfigHandle<
  T extends AliasesMap,
  TInclude extends MultiIncludeConfig<T> = Record<never, never>,
> {
  /** Текущий снапшот запроса (тестовый/дебаг-доступ к AST). */ readonly sqb: KadmiumSqb;
  where(
    fn: (t: MultiFilterProxy<T>) => WhereExpression | SqlFragment | undefined,
  ): MultiConfigHandle<T, TInclude>;
  and(
    fn: (t: MultiFilterProxy<T>) => WhereExpression | SqlFragment | undefined,
  ): MultiConfigHandle<T, TInclude>;
  or(
    fn: (t: MultiFilterProxy<T>) => WhereExpression | SqlFragment | undefined,
  ): MultiConfigHandle<T, TInclude>;
  groupBy(
    fn: (
      t: MultiSelectProxy<T>,
    ) => ReadonlyArray<SelectableField | SqlFragment>,
  ): MultiConfigHandle<T, TInclude>;
  order(
    fn: (
      t: MultiOrderProxy<T>,
    ) => (OrderDirection | SqlOrder<'asc' | 'desc'>)[],
  ): MultiConfigHandle<T, TInclude>;
  limit(n: number): MultiConfigHandle<T, TInclude>;
  offset(n: number): MultiConfigHandle<T, TInclude>;
  join(options: {
    left: keyof T & string;
    right: keyof T & string;
    direction?: 'inner' | 'left' | 'right' | 'outer';
    on: (
      tables: MultiFilterProxy<T>,
    ) => WhereExpression | SqlFragment | undefined;
  }): MultiConfigHandle<T, TInclude>;
  include<const C extends MultiIncludeConfig<T>>(
    config: C,
  ): MultiConfigHandle<T, C>;
  select<const NS extends readonly AnySelectable[]>(
    fn: (t: MultiSelectProxy<T>, tools: SelectTools) => NS,
  ): MultiSelectResult<NS, T, TInclude>;
  select<const NS extends readonly AnySelectable[]>(
    items: NS,
  ): MultiSelectResult<NS, T, TInclude>;
  select<const NS extends AnySelectable>(
    item: NS,
  ): MultiSelectResult<[NS], T, TInclude>;
  /** Терминал count() с SQL-превью — считает все строки (без limit/offset). */
  count(): SqlPreviewTerminal<number>;
  /** Терминал exists() с SQL-превью — LIMIT 1, без влияния offset. */
  exists(): SqlPreviewTerminal<boolean>;
  /** first() = select() + LIMIT 1: одна строка | undefined. */
  first<const NS extends readonly AnySelectable[]>(
    fn: (t: MultiSelectProxy<T>, tools: SelectTools) => NS,
  ): MultiFirstResult<NS, T, TInclude>;
  first<const NS extends readonly AnySelectable[]>(
    items: NS,
  ): MultiFirstResult<NS, T, TInclude>;
  first<const NS extends AnySelectable>(
    item: NS,
  ): MultiFirstResult<[NS], T, TInclude>;
  /** Копия билдера: независимый sqb, общие irs/adapter. */ clone(): MultiConfigHandle<
    T,
    TInclude
  >;
  /** @deprecated Используйте `.compile()`; SQL-preview — `.compile().sql()`. */ toSql(): string;
}
