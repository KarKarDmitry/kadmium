import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../ir/index';
import { KadmiumSqb } from '../sqb';
import type { FilterProxy, SelectProxy } from '../types/proxy';
import { toSqlValue } from '../sql-fragment';
import type { AnySelectable, FlatFinalResult } from '../types/includes';
import type { SelectableField } from '../ast/selectable';
import { createFilterProxy, createSelectProxy } from './query-proxies';
import { buildConflictSteps, buildCreateFinalizer } from './upsert-helpers';
import { assertDmlInsert } from '../guards';

/** Минимальный контракт модели для INSERT. */
type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

/**
 * Данные VALUES: объект значений или коллбэк с типизированным proxy.
 *
 * Тот же контракт, что у `DmlData`/`SetData` — все три описывают «значения для
 * записи через колонки модели», и коллбэк нужен ради `sql`-фрагментов:
 * `values({ registeredAt: sql`now()` })` или `values(t => ({ ... }))`.
 *
 * **Ограничение**: коллбэк НЕ может ссылаться на поля самой модели
 * (`sql`${t.name}``). VALUES описывает ещё не существующую строку, а рендер
 * квалифицирует ссылку алиасом (`"User"."name"`); у INSERT нет FROM, поэтому PG
 * отвечает 42P01. Это то же ограничение, что у RETURNING у INSERT. Полезные
 * фрагменты в VALUES — выражения без полей модели: `now()`, `lower($1)`,
 * арифметика над параметрами.
 */
export type InsertData<TModel extends Model> =
  | Record<string, unknown>
  | ((t: FilterProxy<TModel>) => Record<string, unknown>);

/**
 * Публичная поверхность `orm.insert(Model)`.
 *
 * Узкая намеренно: НЕТ `where`/`order`/`limit`/`offset`/`page`/`cursor`/
 * `groupBy`/`include`. sql-pg рендерит INSERT только из данных и конфликтной
 * клаузы — фильтр потерялся бы молча (`.where(...).insert()` создал бы строку
 * ВСЕГДА, см. `assertDmlInsertNoWhere`). Отсутствие методов на типе — основной
 * защитник; `assertDmlInsert` остаётся defense-in-depth для JS.
 *
 * `values()` — обязательный шаг, как `set()` у `update`: оба write-входа берут
 * данные шагом, а не аргументом входа. Имена зеркалят SQL — VALUES и SET.
 */
export interface InsertHandle<TModel extends Model> {
  /**
   * Данные VALUES — обязательный шаг. Ключи — имена полей модели, значения
   * мапятся на алиасы колонок (`{ name }` → колонка `name`).
   */
  values(data: InsertData<TModel>): InsertHandle<TModel>;

  /** Конфликтная клауза: `(t) => [t.email]` → `ON CONFLICT ("email")`. */
  onConflict(
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ): InsertHandle<TModel>;

  /** DO UPDATE SET для найденного конфликта. Требует `onConflict()`. */
  set(data: InsertData<TModel>): InsertHandle<TModel>;

  /** DO NOTHING — побеждает `set()` на рендере. Требует `onConflict()`. */
  doNothing(): InsertHandle<TModel>;

  /**
   * Проекция RETURNING. Без неё `go()` возвращает вставленную строку целиком.
   */
  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>) => S,
  ): InsertReturningTerminal<S>;

  /** Выполнить INSERT и вернуть вставленную строку. */
  go(): Promise<TModel['~shape']>;

  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Терминал `returning()`: одна вставленная строка по проекции + SQL-превью.
 *
 * Параметр модели не нужен — результат описывается проекцией `S`.
 */
export interface InsertReturningTerminal<S extends readonly AnySelectable[]> {
  go(): Promise<FlatFinalResult<S>>;
  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Билдер операции INSERT (одна строка).
 *
 * НЕ наследует `BaseQueryBuilder` — по той же причине, что и UPDATE/DELETE:
 * база несёт `where/order/limit`, которые в INSERT не рендерятся. Разрешённые
 * шаги перечислены явно.
 *
 * Одиночная вставка идёт через `operation='upsert'` → `adapter.execute(sqb)` —
 * это единственный путь, где RETURNING рендерится из `sqb.selects`. Батч
 * (`insert-many.ts`) уходит в `adapter.createMany()` мимо sqb.
 */
export class InsertBuilder<TModel extends Model> {
  public sqb: KadmiumSqb;
  private ir: ModelIR;
  private adapter: SqlAdapter | null;
  private hasValues = false;

  constructor(
    ir: ModelIR,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.ir = ir;
    this.adapter = adapter ?? null;
    this.sqb = new KadmiumSqb();
    this.sqb.tableContext.set(ir.name, ir.collection);
    // INSERT объявляется сразу: operation нужен финализатору, а гард проверяет,
    // что пользователь не принёс нерендерящиеся шаги.
    this.sqb.operation = 'upsert';
  }

  values(data: InsertData<TModel>): InsertHandle<TModel> {
    assertDmlInsert(this.sqb);
    this.sqb.upsertData = this._mapData(data);
    this.hasValues = true;
    return this as unknown as InsertHandle<TModel>;
  }

  onConflict(
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ): InsertHandle<TModel> {
    this._requireValues();
    this._conflict().onConflict(fn as never);
    return this as unknown as InsertHandle<TModel>;
  }

  set(data: InsertData<TModel>): InsertHandle<TModel> {
    this._requireValues();
    this._conflict().set(data as never);
    return this as unknown as InsertHandle<TModel>;
  }

  doNothing(): InsertHandle<TModel> {
    this._requireValues();
    this._conflict().doNothing();
    return this as unknown as InsertHandle<TModel>;
  }

  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>) => S,
  ): InsertReturningTerminal<S> {
    this._requireValues();
    return this._finalizer().returning(
      fn as never,
    ) as InsertReturningTerminal<S>;
  }

  go(): Promise<TModel['~shape']> {
    this._requireValues();
    return this._finalizer().go() as Promise<TModel['~shape']>;
  }

  sql(): string {
    this._requireValues();
    return this._finalizer().sql();
  }

  /**
   * Конфликтные шаги пишут в `this.sqb` НАПРЯМУЮ, а не в клон финализатора:
   * состояние конфликта должно пережить вызов, иначе `onConflict()` потеряется
   * к моменту `go()` — ровно та ошибка, что чинилась в `update.ts`.
   *
   * Значение `rebuild` не используется: шаги только мутируют sqb и зовут
   * пересборку, а нам нужен сам билдер для поддержания флоу-типа.
   */
  private _conflict() {
    return buildConflictSteps<TModel, InsertHandle<TModel>>(
      this.sqb,
      this.ir,
      () => this as unknown as InsertHandle<TModel>,
    );
  }

  /** Финализатор поверх клона sqb — терминалы не мутируют билдер. */
  private _finalizer() {
    return buildCreateFinalizer<TModel>(
      this.sqb.clone(),
      this._requireAdapter(),
      this.ir,
      this.sqb.upsertData ?? {},
    );
  }

  /** Раскладка ключей: имя поля → алиас колонки + нормализация значения. */
  private _mapData(data: InsertData<TModel>): Record<string, unknown> {
    const values =
      typeof data === 'function' ? data(this._createFilterProxy()) : data;
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      mapped[this.ir.fields[k]?.alias ?? k] = toSqlValue(v);
    }
    return mapped;
  }

  private _requireAdapter(): SqlAdapter {
    if (!this.adapter) {
      throw new Error(
        'No adapter configured; call .go() only with an adapter.',
      );
    }
    return this.adapter;
  }

  private _requireValues(): void {
    if (!this.hasValues) {
      throw new Error(
        'insert() requires values(data): call .values({ ... }) before .onConflict()/.set()/.returning()/.go().',
      );
    }
  }

  private _defaultAlias(): string {
    return [...this.sqb.tableContext.keys()][0] ?? this.ir.name;
  }

  private _createFilterProxy(): FilterProxy<TModel> {
    return createFilterProxy(this._defaultAlias(), this.ir, this.sqb);
  }

  private _createSelectProxy(): SelectProxy<TModel> {
    return createSelectProxy(this._defaultAlias(), this.ir);
  }
}
