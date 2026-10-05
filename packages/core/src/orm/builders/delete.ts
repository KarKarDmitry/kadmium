import type { SqlAdapter } from '@karkardmitry/kadmium-sql-types';
import type { ModelIR } from '../../ir/index';
import { KadmiumSqb } from '../sqb';
import type { FilterProxy, ReturningTools, SelectProxy } from '../types/proxy';
import type { WhereExpression } from '../ast/where';
import { toSqlCondition, type SqlFragment } from '../sql-fragment';
import type { AnySelectable, FlatFinalResult } from '../types/includes';
import { createFilterProxy, createSelectProxy } from './query-proxies';
import { buildWriteFinalizer } from './write-finalizer';
import { mapRow } from './utils';
import { buildCoercionNode, type IrLookup } from './coerce';

/** Минимальный контракт модели для DELETE. */
type Model = {
  ['~shape']: Record<string, unknown>;
  ['~rel']: Record<string, unknown>;
  ['~relInfo']: Record<string, unknown>;
};

/**
 * Публичная поверхность `orm.delete(Model)`.
 *
 * Узкая намеренно: НЕТ `order`/`limit`/`offset`/`page`/`cursor`/`groupBy`/
 * `include`/`first`. sql-pg рендерит DELETE только из wheres, поэтому
 * такие шаги были бы молча отброшены — `.limit(1).delete()` удалил бы ВСЕ
 * строки. Здесь защита только типовая: в отличие от UPDATE, гард не нужен,
 * т.к. нет `set()`, куда его было бы повесить, а свежий sqb в конструкторе
 * пуст и нерендерящиеся шаги в него попасть не могут.
 *
 * `where` опционален: DELETE без фильтра удаляет все строки таблицы.
 * Это осознанное решение (то же, что у UPDATE), а не недосмотр —
 * требование «WHERE обязателен» отклонено как продуктовое (см. AGENTS.md).
 */
export interface DeleteHandle<TModel extends Model> {
  /** Фильтр строк. Без него удаляются все строки. */
  where(
    fn: (t: FilterProxy<TModel>) => WhereExpression | SqlFragment | undefined,
  ): DeleteHandle<TModel>;

  /** Проекция RETURNING. Без неё `go()` возвращает полные строки. */
  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ): DeleteReturningTerminal<S>;

  /** Выполнить DELETE и вернуть удалённые строки. */
  go(): Promise<TModel['~shape'][]>;

  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Терминал `returning()`: удалённые строки по проекции + SQL-превью.
 *
 * Параметр модели не нужен — результат описывается проекцией `S`
 * (тот же контракт, что у `buildWriteFinalizer`).
 */
export interface DeleteReturningTerminal<S extends readonly AnySelectable[]> {
  go(): Promise<FlatFinalResult<S>[]>;
  /** @deprecated Отладочный SQL-превью. */
  sql(): string;
}

/**
 * Билдер операции DELETE.
 *
 * НЕ наследует `BaseQueryBuilder` — по той же причине, что и UPDATE:
 * база несёт `order/limit/offset/cursor/groupBy`, которые в DELETE
 * молча игнорируются рендером. Разрешённые шаги перечислены явно.
 *
 * Общего DML-родителя с `UpdateQueryBuilder` нет: у DELETE нет `set()`,
 * а сходство ограничено `where/returning/go/sql`. Переиспользуется
 * общий `buildWriteFinalizer`, но каждый билдер объявляет свой набор
 * шагов самостоятельно — это и было целью разделения на файлы.
 */
export class DeleteQueryBuilder<TModel extends Model> {
  public sqb: KadmiumSqb;
  private ir: ModelIR;
  private irLookup: IrLookup;
  private adapter: SqlAdapter | null;

  constructor(
    ir: ModelIR,
    irLookup?: (name: string) => ModelIR | undefined,
    adapter?: SqlAdapter,
  ) {
    this.ir = ir;
    // Нужен для приведения значений при чтении: FK-колонка хранит PK цели,
    // поэтому сторож точности берётся у целевой модели.
    this.irLookup = irLookup ?? (() => undefined);
    this.adapter = adapter ?? null;
    this.sqb = new KadmiumSqb();
    this.sqb.tableContext.set(ir.name, ir.collection);
    // DELETE объявляется сразу: operation нужен финализатору для рендера.
    this.sqb.operation = 'delete';
  }

  /**
   * Фильтр пушится в `this.sqb`, а не в клон финализатора: терминалы
   * строятся ПОСЛЕ where(), из клона уже собранного sqb. Иначе условие
   * ушло бы в одноразовый клон и потерялось.
   */
  where(
    fn: (t: FilterProxy<TModel>) => WhereExpression | SqlFragment | undefined,
  ): DeleteHandle<TModel> {
    const expression = fn(this._createFilterProxy());
    if (expression !== undefined) {
      this.sqb.wheres.elements.push({
        join: 'AND',
        condition: toSqlCondition(expression),
      });
    }
    return this as unknown as DeleteHandle<TModel>;
  }

  returning<S extends readonly AnySelectable[]>(
    fn: (t: SelectProxy<TModel>, tools: ReturningTools) => S,
  ): DeleteReturningTerminal<S> {
    return this._finalizer().returning(
      fn as never,
    ) as DeleteReturningTerminal<S>;
  }

  go(): Promise<TModel['~shape'][]> {
    return this._finalizer().go();
  }

  sql(): string {
    return this._finalizer().sql();
  }

  /** Снапшот финализатора поверх клона sqb — терминалы не мутируют билдер. */
  private _finalizer() {
    const sqb = this.sqb.clone();
    return buildWriteFinalizer<TModel>(
      sqb,
      this.adapter,
      () => this._createFilterProxy(),
      () => this._createSelectProxy(),
      (row) => mapRow(this.ir, row),
      () =>
        buildCoercionNode(this.ir, sqb.selects, sqb.includes, this.irLookup),
    );
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
