/**
 * QuerySlots — декларация именованных слотов из модели (План 3, B1).
 * Типы слотов выводятся из SelectProxy (известные фантомы), имя ограничено
 * ключами ToDef<S>, значение типизировано напрямую из кортежа.
 * Колбэк push() НЕ исполняется — чисто type-level накопление.
 */
import type { SelectProxy, GetFieldName, GetFieldType } from './types/proxy';
import type { AggregateFunctions } from './field-builders/aggregates';
import type { AnySelectable } from './types/includes';
import type { AnyArrayField } from './ast/array-field';
import type { SlotDefinition } from '@karkardmitry/kadmium-sql-types';
import { SlotMarker } from './slot';

/** Извлечение { имя → тип значения } из кортежа selectable/агрегат/массив-слот. */
export type ToDef<S extends readonly any[]> = {
  [Sel in S[number] as GetFieldName<Sel>]: GetFieldType<Sel>;
};

/**
 * QuerySlots<TModel, S> — generic хранит типизированный кортеж `S` напрямую.
 * `ToDef<S>` даёт ключи и типы значений; `_seen` Set — runtime-аналог.
 */
export class QuerySlots<
  TModel extends { ['~shape']: Record<string, unknown> },
  S extends readonly (AnySelectable | AnyArrayField)[] = readonly never[],
> {
  /** Имена, реально запрошенные через .slot() (runtime-аналог ключей ToDef<S>; B1, вариант A). */
  private _seen = new Set<string>();

  constructor(_model: { new (): TModel }) {}

  push<NS extends readonly (AnySelectable | AnyArrayField)[]>(
    _fn: (u: SelectProxy<TModel>, aggs: AggregateFunctions) => NS,
  ): QuerySlots<TModel, [...S, ...NS]> {
    return this as QuerySlots<TModel, [...S, ...NS]>;
  }

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
