import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../ir/index';
import { KadmiumSqb } from '../sqb';
import type { FilterProxy, SelectProxy } from '../types/proxy';
import type { WhereExpression } from '../ast/where';
import { toSqlCondition, toSqlValue, type SqlFragment } from '../sql-fragment';
import type { AnySelectable, FlatFinalResult } from '../types/includes';
import { createFilterProxy, createSelectProxy } from './query-proxies';
import { buildWriteFinalizer } from './write-finalizer';
import { mapRow } from './utils';
import { assertDmlUpdate } from '../guards';

/** Минимальный контракт модели для UPDATE. */
type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

/**
 * Данные SET: объект значений или коллбэк с типизированным proxy (F),
 * чтобы внутри sql-фрагмента сослаться на колонку: `sql`${t.views} + 1``.
 */
export type SetData<TModel extends Model> =
  | Record<string, unknown>
  | ((t: FilterProxy<TModel>) => Record<string, unknown>);

/**
 * Публичная поверхность `orm.update(Model)`.
 *
 * Узкая намеренно: НЕТ `order`/`limit`/`offset`/`page`/`cursor`/`groupBy`/
 * `include`/`first`. sql-pg рендерит UPDATE только из SET-данных и wheres,
 * поэтому такие шаги были бы молча отброшены (`.limit(1).update()` обновил бы
 * ВСЕ строки). Отсутствие методов на типе — основной защитник; гард
 * `assertDmlUpdate` в `set()` остаётся defense-in-depth для JS.
 */
export interface UpdateHandle<TModel extends Model> {
  /**
   * Данные SET — обязательный шаг. Ключи — имена полей модели,
   * значения мапятся на алиасы колонок (`{ views }` → колонка `views`).
   */
  set(data: SetData<TModel>): UpdateHandle<TModel>;

  /** Фильтр строк. Не обязателен: UPDATE без where меняет все строки. */
  where(
    fn: (t: FilterProxy<TModel>) => WhereExpression | SqlFragment | undefined,
  ): UpdateHandle<TModel>;

  /** Проекция RETURNING. Без неё `go()` возвращает полные строки. */
  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>) => S,
  ): ReturningTerminal<S>;

  /** Выполнить UPDATE и вернуть затронутые строки. */
  go(): Promise<TModel['~shape'][]>;

  /** @deprecated Используйте `.compile()`-подобный путь; SQL — для отладки. */
  sql(): string;
}

/**
 * Терминал `returning()`: строки по проекции + SQL-превью.
 *
 * Параметр модели не нужен — результат описывается проекцией `S`
 * (тот же контракт, что у `buildWriteFinalizer`).
 */
export interface ReturningTerminal<S extends readonly AnySelectable[]> {
  go(): Promise<FlatFinalResult<S>[]>;
  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Билдер операции UPDATE.
 *
 * НЕ наследует `BaseQueryBuilder`: тот несёт `where/and/or/order/groupBy/
 * limit/offset`, а в UPDATE почти всё это молча игнорируется рендером.
 * Наследование пришлось бы компенсировать type-level сужением (как в
 * `handles.ts`) — здесь проще не наследовать вовсе и перечислить
 * разрешённые шаги явно. Общего DML-родителя у update/delete нет:
 * `delete.ts` объявляет своё независимое сходство — `where/returning/go/sql`.
 */
export class UpdateQueryBuilder<TModel extends Model> {
  public sqb: KadmiumSqb;
  private ir: ModelIR;
  private adapter: SqlAdapter | null;
  private hasSet = false;

  constructor(
    ir: ModelIR,
    private irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.ir = ir;
    this.adapter = adapter ?? null;
    this.sqb = new KadmiumSqb();
    this.sqb.tableContext.set(ir.name, ir.collection);
    // UPDATE объявляется сразу: operation нужен финализатору, а гард
    // проверяет, что пользователь не принёс нерендерящиеся шаги.
    this.sqb.operation = 'update';
  }

  set(data: SetData<TModel>): UpdateHandle<TModel> {
    assertDmlUpdate(this.sqb);
    this.sqb.updateData = this._mapData(data);
    this.hasSet = true;
    return this as unknown as UpdateHandle<TModel>;
  }

  /**
   * Фильтр пушится в `this.sqb`, а не в клон финализатора: терминалы
   * строятся ПОСЛЕ where(), из клона уже собранного sqb. Иначе условие
   * ушло бы в одноразовый клон и потерялось.
   */
  where(
    fn: (t: FilterProxy<TModel>) => WhereExpression | SqlFragment | undefined,
  ): UpdateHandle<TModel> {
    this._requireSet();
    const expression = fn(this._createFilterProxy());
    if (expression !== undefined) {
      this.sqb.wheres.elements.push({
        join: 'AND',
        condition: toSqlCondition(expression),
      });
    }
    return this as unknown as UpdateHandle<TModel>;
  }

  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>) => S,
  ): ReturningTerminal<S> {
    this._requireSet();
    return this._finalizer().returning(fn as never) as ReturningTerminal<S>;
  }

  go(): Promise<TModel['~shape'][]> {
    this._requireSet();
    return this._finalizer().go();
  }

  sql(): string {
    this._requireSet();
    return this._finalizer().sql();
  }

  /** Снапшот финализатора поверх клона sqb — терминалы не мутируют билдер. */
  private _finalizer() {
    return buildWriteFinalizer<TModel>(
      this.sqb.clone(),
      this.adapter,
      () => this._createFilterProxy(),
      () => this._createSelectProxy(),
      (row) => mapRow(this.ir, row),
    );
  }

  /** Раскладка ключей SET: имя поля → алиас колонки + нормализация значения. */
  private _mapData(data: SetData<TModel>): Record<string, unknown> {
    const values =
      typeof data === 'function' ? data(this._createFilterProxy()) : data;
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      mapped[this.ir.fields[k]?.alias ?? k] = toSqlValue(v);
    }
    return mapped;
  }

  private _requireSet(): void {
    if (!this.hasSet) {
      throw new Error(
        'update() requires set(data): call .set({ ... }) before .go()/.where()/.returning().',
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
