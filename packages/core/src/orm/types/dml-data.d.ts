import type { SqlFragment } from '../sql-fragment';
import type { FilterProxy } from './proxy';

/**
 * Типы данных для DML-шагов (`values()`, `set()`).
 *
 * Ключи берутся из `~shape` модели — того же фантома, на котором стоят
 * `FilterProxy`/`SelectProxy`, — поэтому IDE подсказывает поля, а опечатка в
 * ключе или неверный тип значения ловятся компилятором, а не PostgreSQL
 * (`42703` / `22P02`).
 *
 * Кроме `~shape` учитывается фантом `~defaults` от кодогена: он перечисляет
 * поля, значение которых подставит сама БД, и такие поля не обязательны при
 * вставке даже когда они NOT NULL.
 *
 * В проекте без кодогена `~shape` — это `Record<string, unknown>`, и типы
 * деградируют до индексной сигнатуры: подсказок не будет, но и новых ошибок
 * не появится.
 */

/**
 * DmlValue — значение одной ячейки: значение поля модели ИЛИ sql-фрагмент.
 *
 * Фрагменты нужны для выражений над колонками: `sql`${p.views} + 1``.
 * Значение-фрагмент прекомпилируется в `SqlValue` и подставляется параметром,
 * а не склеивается в текст.
 *
 * `null` разрешён только там, где колонка nullable — то есть ровно там, где её
 * тип в `~shape` содержит `| undefined`. В NOT NULL-колонку `null` это
 * `23502 not_null_violation`, поэтому на уровне типов он отвергается.
 */
export type DmlValue<V> =
  V | SqlFragment | (undefined extends V ? null : never);

/** Shape модели: типы её колонок для чтения. */
type Shape<TModel> = TModel extends { ['~shape']: infer S } ? S : never;

/** Имена колонок модели. */
type FieldNames<TModel> = keyof Shape<TModel> & string;

/**
 * NOT NULL-поля — те, чей тип в `~shape` не содержит `| undefined`.
 *
 * `-?` обязателен: иначе модификатор опциональности из источника уедет в
 * результат, и `undefined extends S[K]` начнёт быть истинным для всего.
 */
type NotNullFields<TModel> = {
  [K in FieldNames<TModel>]-?: undefined extends Shape<TModel>[K] ? never : K;
}[FieldNames<TModel>];

/** Поля, которые заполняет БД сама (фантом `~defaults`). */
type DbFilledFields<TModel> = TModel extends { ['~defaults']: infer D }
  ? keyof D & string
  : never;

/**
 * Обязательные при вставке: NOT NULL и без DB-default.
 *
 * Неполный INSERT — это `23502 not_null_violation` в рантайме, поэтому он
 * ловится здесь. Nullable-поля (`| undefined`) и defaulted-поля (`~defaults`)
 * в набор не попадают.
 */
type RequiredOnInsert<TModel> = Exclude<
  NotNullFields<TModel>,
  DbFilledFields<TModel>
>;

/**
 * SetValues — объектная форма `set()` и `onConflict().set()`: всегда
 * частичная, потому что UPDATE и DO UPDATE SET меняют лишь перечисленные
 * колонки.
 */
export type SetValues<TModel> = {
  [K in FieldNames<TModel>]?: DmlValue<Shape<TModel>[K]>;
};

/**
 * InsertValuesData — данные `values()`: обязательные поля обязательны,
 * остальные можно опустить.
 *
 * Пересечение двух mapped-типов непригодно: TypeScript считает источник
 * подходящим к пересечению, если он подходит к ЛЮБОМУ его члену, а пустой
 * член (`{}`, когда обязательных полей нет) подходит ко всему, включая
 * функцию. Коллбэк-форма `values()` прошла бы компиляцию, а на разборе дала
 * бы пустые данные — `Object.entries(fn)` это `[]`.
 *
 * Поэтому при пустом `RequiredOnInsert` тип вырождается в один
 * `SetValues`, а пересечение строится только когда есть что требовать.
 */
export type InsertValuesData<TModel> = [RequiredOnInsert<TModel>] extends [
  never,
]
  ? SetValues<TModel>
  : {
      [K in RequiredOnInsert<TModel>]: DmlValue<Shape<TModel>[K]>;
    } & SetValues<TModel>;

/**
 * SetData — `set()`: объект или колбэк с типизированным proxy.
 *
 * Колбэк нужен, чтобы сослаться на колонку в выражении:
 * `set((p) => ({ views: sql`${p.views} + 1` }))`.
 */
export type SetData<TModel extends { ['~shape']: Record<string, unknown> }> =
  SetValues<TModel> | ((p: FilterProxy<TModel>) => SetValues<TModel>);

/**
 * RawDmlData — ослабленная форма для колонок, которых нет в модели.
 *
 * Нужен на миграциях и сырых вставках: типизированные входы не дают передать
 * колонку, которой нет в `~shape`, поэтому для такого случая отдельный вход
 * с честным `Record<string, unknown>` вместо каста.
 */
export type RawDmlData = Record<string, unknown>;
