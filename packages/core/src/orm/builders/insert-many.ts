import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../ir/index';
import { KadmiumSqb } from '../sqb';
import type { FilterProxy, ReturningTools, SelectProxy } from '../types/proxy';
import { toSqlValue } from '../sql-fragment';
import type { AnySelectable, FlatFinalResult } from '../types/includes';
import type { SelectableField } from '../ast/selectable';
import type { InsertValuesData, RawDmlData, SetData } from '../types/dml-data';
import { createFilterProxy } from './query-proxies';
import {
  buildConflictSteps,
  buildCreateManyFinalizer,
  type CreateManyFinalizer,
} from './upsert-helpers';
import { assertDmlInsert } from '../guards';

/** Минимальный контракт модели для batch INSERT. */
type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

/**
 * Публичная поверхность `orm.insertMany(Model)`.
 *
 * Зеркалит `orm.insert(Model)`: те же `values/onConflict/set/doNothing/returning`,
 * те же намеренно отсутствующие select-шаги. Добавлен один шаг — `transaction`.
 *
 * `transaction` — метод, а не опция второго аргумента: вся write-поверхность
 * CRUD-API собирается шагами, и опция-в-аргументе была бы единственным
 * исключением. Вызов перезаписывает дефолт (по умолчанию true — как в legacy
 * `createMany({ transaction })`).
 */
export interface InsertManyHandle<TModel extends Model> {
  /**
   * Строки VALUES — обязательный шаг. Пустой массив — ошибка (см.
   * `InsertManyBuilder._requireValues`).
   */
  values(data: InsertValuesData<TModel>[]): InsertManyHandle<TModel>;

  /**
   * Как `values()`, но для колонок, которых нет в модели — типизированный вход
   * такую колонку не пропустит. Пустой массив — та же ошибка.
   */
  valuesRaw(data: RawDmlData[]): InsertManyHandle<TModel>;

  /** Конфликтная клауза: `(t) => [t.email]` → `ON CONFLICT ("email")`. */
  onConflict(
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ): InsertManyHandle<TModel>;

  /** DO UPDATE SET для найденных конфликтов. Требует `onConflict()`. */
  set(data: SetData<TModel>): InsertManyHandle<TModel>;

  /** Как `set()`, но для колонок, которых нет в модели. */
  setRaw(data: RawDmlData): InsertManyHandle<TModel>;

  /** DO NOTHING — побеждает `set()` на рендере. Требует `onConflict()`. */
  doNothing(): InsertManyHandle<TModel>;

  /**
   * Выполнить INSERT в одной транзакции (по умолчанию) или без неё.
   * Без транзакции батч идёт одним multi-row statement — он атомарен сам
   * по себе, но ошибка не откатывает уже применённые батчи в вызывающем коде.
   */
  transaction(enabled: boolean): InsertManyHandle<TModel>;

  /** Проекция RETURNING. Без неё `go()` возвращает полные строки. */
  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ): InsertManyReturningTerminal<S>;

  /** Выполнить batch INSERT и вернуть вставленные строки. */
  go(): Promise<TModel['~shape'][]>;

  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Терминал `returning()` для батча: массив строк по проекции `S` + SQL-превью.
 *
 * Отдельный тип от `InsertReturningTerminal` — там одна строка, здесь массив.
 */
export interface InsertManyReturningTerminal<
  S extends readonly AnySelectable[],
> {
  go(): Promise<FlatFinalResult<S>[]>;
  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Билдер операции batch INSERT.
 *
 * НЕ наследует `BaseQueryBuilder` — как и остальные write-билдеры, потому что
 * база несёт `where/order/limit`, не рендерящиеся в INSERT.
 *
 * Батч уходит в `adapter.createMany()` мимо sqb (в отличие от одиночного
 * `insert()`, идущего через `operation='upsert'` → `adapter.execute`).
 * Конфликтные шаги пишут в `this.sqb` напрямую, как в `InsertBuilder`, иначе
 * состояние потерялось бы к моменту `go()`.
 */
export class InsertManyBuilder<TModel extends Model> {
  public sqb: KadmiumSqb;
  private ir: ModelIR;
  private adapter: SqlAdapter | null;
  private mappedRows: Record<string, unknown>[] | null = null;
  private transactionEnabled = true;

  constructor(
    ir: ModelIR,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.ir = ir;
    this.adapter = adapter ?? null;
    this.sqb = new KadmiumSqb();
    this.sqb.tableContext.set(ir.name, ir.collection);
    this.sqb.operation = 'upsert';
  }

  values(data: InsertValuesData<TModel>[]): InsertManyHandle<TModel> {
    return this.valuesRaw(data as RawDmlData[]);
  }

  valuesRaw(data: RawDmlData[]): InsertManyHandle<TModel> {
    assertDmlInsert(this.sqb);
    this.mappedRows = data.map((row) => this._mapData(row));
    return this as unknown as InsertManyHandle<TModel>;
  }

  onConflict(
    fn: (t: SelectProxy<TModel>) => readonly SelectableField[],
  ): InsertManyHandle<TModel> {
    this._requireValues();
    this._conflict().onConflict(fn as never);
    return this as unknown as InsertManyHandle<TModel>;
  }

  set(data: SetData<TModel>): InsertManyHandle<TModel> {
    return this.setRaw(data as RawDmlData);
  }

  setRaw(data: RawDmlData): InsertManyHandle<TModel> {
    this._requireValues();
    this._conflict().set(data as never);
    return this as unknown as InsertManyHandle<TModel>;
  }

  doNothing(): InsertManyHandle<TModel> {
    this._requireValues();
    this._conflict().doNothing();
    return this as unknown as InsertManyHandle<TModel>;
  }

  transaction(enabled: boolean): InsertManyHandle<TModel> {
    this._requireValues();
    this.transactionEnabled = enabled;
    return this as unknown as InsertManyHandle<TModel>;
  }

  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ): InsertManyReturningTerminal<S> {
    this._requireValues();
    return this._finalizer().returning(
      fn as never,
    ) as InsertManyReturningTerminal<S>;
  }

  go(): Promise<TModel['~shape'][]> {
    this._requireValues();
    return this._finalizer().go() as Promise<TModel['~shape'][]>;
  }

  sql(): string {
    this._requireValues();
    return this._finalizer().sql();
  }

  /** Конфликтные шаги мутируют `this.sqb` — состояние переживает вызов. */
  private _conflict() {
    return buildConflictSteps<TModel, InsertManyHandle<TModel>>(
      this.sqb,
      this.ir,
      () => this as unknown as InsertManyHandle<TModel>,
    );
  }

  /** Финализатор поверх клона sqb — терминалы не мутируют билдер. */
  private _finalizer() {
    return buildCreateManyFinalizer<TModel>(
      this.sqb.clone(),
      this._requireAdapter(),
      this.ir,
      this.mappedRows ?? [],
      { transaction: this.transactionEnabled },
    );
  }

  /**
   * Раскладка ключей строки: имя поля → алиас колонки + нормализация значения.
   *
   * Вход всегда объект — коллбэк у VALUES убран (см. `types/dml-data`), а
   * коллбэк конфликтного `set()` раскладывает `upsert-helpers`.
   */
  private _mapData(data: RawDmlData): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      mapped[this.ir.fields[k]?.alias ?? k] = toSqlValue(v);
    }
    return mapped;
  }

  private _requireAdapter(): SqlAdapter {
    if (!this.adapter) {
      throw new Error('No adapter configured; cannot execute query.');
    }
    return this.adapter;
  }

  private _requireValues(): void {
    if (!this.mappedRows) {
      throw new Error(
        'insertMany() requires values(rows): call .values([...]) before .onConflict()/.returning()/.go().',
      );
    }
    if (this.mappedRows.length === 0) {
      throw new Error(
        'insertMany() requires at least one row: .values([]) would insert nothing.',
      );
    }
  }

  private _defaultAlias(): string {
    return [...this.sqb.tableContext.keys()][0] ?? this.ir.name;
  }

  private _createFilterProxy(): FilterProxy<TModel> {
    return createFilterProxy(this._defaultAlias(), this.ir, this.sqb);
  }
}

export type { CreateManyFinalizer };
