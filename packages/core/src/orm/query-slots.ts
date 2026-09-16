/**
 * QuerySlots / MultiQuerySlots — декларация именованных слотов (План 3, B1/B4).
 * Типы слотов выводятся из SelectProxy/MultiSelectProxy (известные фантомы),
 * имя ограничено ключами ToDef<S>, значение типизировано напрямую из кортежа.
 * Колбэк push() НЕ исполняется — чисто type-level накопление.
 */
import type {
  SelectProxy,
  MultiSelectProxy,
  GetFieldName,
  GetFieldType,
  AliasesMap,
} from './types/proxy';
import type { AggregateFunctions } from './field-builders/aggregates';
import type { AnySelectable } from './types/includes';
import type { AnyArrayField } from './ast/array-field';
import type { SlotDefinition } from '@karkardmitry/kadmium-sql-types';
import { SlotMarker } from './slot';

/** Извлечение { имя → тип значения } из кортежа selectable/агрегат/массив-слот. */
export type ToDef<S extends readonly unknown[]> = {
  [Sel in S[number] as GetFieldName<Sel>]: GetFieldType<Sel>;
};

/**
 * BaseQuerySlots<S> — общая runtime-часть: набор реально запрошенных имён
 * (`_seen`, runtime-аналог ключей ToDef<S>) и типизированный slot() поверх
 * ToDef<S>. Наследники добавляют push() с источником полей: SelectProxy одной
 * модели (QuerySlots) либо MultiSelectProxy алиасов (MultiQuerySlots).
 */
abstract class BaseQuerySlots<
  S extends readonly (AnySelectable | AnyArrayField)[],
> {
  protected _seen = new Set<string>();

  /**
   * Типизированный слот: имя ⊆ ключи ToDef<S>, значение-тип извлекается
   * из кортежа напрямую (без индексации по Record<string, never>).
   */
  slot<K extends keyof ToDef<S> & string>(k: K): SlotMarker<K, ToDef<S>[K]> {
    this._seen.add(k);
    return new SlotMarker<K, ToDef<S>[K]>(k);
  }

  /** Проверка «слоты не придуманы на месте»: имя из slotOrder обязано быть декларировано .slot(). */
  assertSlotNames(slotOrder: readonly SlotDefinition[]): void {
    const unknown = slotOrder.filter((s) => !this._seen.has(s.name));
    if (unknown.length > 0) {
      throw new Error(
        `Slot(s) not declared in QuerySlots: ${unknown
          .map((s) => s.name)
          .join(
            ', ',
          )} — use S.slot(name) or a flat slot('...') with compile<T>()`,
      );
    }
  }
}

/**
 * QuerySlots<TModel, S> — типизированные слоты из полей одной модели.
 * generic хранит типизированный кортеж `S` напрямую.
 */
export class QuerySlots<
  TModel extends { ['~shape']: Record<string, unknown> },
  S extends readonly (AnySelectable | AnyArrayField)[] = readonly never[],
> extends BaseQuerySlots<S> {
  constructor(_model: { new (): TModel }) {
    super();
  }

  push<NS extends readonly (AnySelectable | AnyArrayField)[]>(
    _fn: (u: SelectProxy<TModel>, aggs: AggregateFunctions) => NS,
  ): QuerySlots<TModel, [...S, ...NS]> {
    return this as QuerySlots<TModel, [...S, ...NS]>;
  }
}

/**
 * MultiQuerySlots<T, S> — типизированные слоты из полей алиасов multi-запроса.
 * Источник — MultiSelectProxy<T>: `(t) => [t.u.tenantId, t.p.author]`.
 * Имена слотов глобальны по всем алиасам; при совпадении колонок используйте
 * `.as('u_id')`, чтобы развести имена.
 */
export class MultiQuerySlots<
  T extends AliasesMap,
  S extends readonly (AnySelectable | AnyArrayField)[] = readonly never[],
> extends BaseQuerySlots<S> {
  constructor(_aliases: T) {
    super();
  }

  push<NS extends readonly (AnySelectable | AnyArrayField)[]>(
    _fn: (t: MultiSelectProxy<T>, aggs: AggregateFunctions) => NS,
  ): MultiQuerySlots<T, [...S, ...NS]> {
    return this as MultiQuerySlots<T, [...S, ...NS]>;
  }
}
