import { BaseFilter } from './field-builders/base-filter';
import type { KadmiumSqb } from './sqb';
import type { HoleRef } from '@karkardmitry/kadmium-sql-types';

/**
 * SlotMarker — именованный слот: value-место, заполняемое compile().fill()
 * (B1/B2). Наследует BaseFilter<V>, чтобы проходить eq-site (V = any для
 * плоского slot()). В рантайме — обычный объект { kind: 'slot', slotName };
 * sql-pg распознаёт его duck-typing'ом, не импортируя core.
 */
export class SlotMarker<
  K extends string = string,
  V = unknown,
> extends BaseFilter<V> {
  readonly kind = 'slot' as const;
  constructor(public readonly slotName: K) {
    // sqb/alias для маркера не используются (никогда не рендерятся как
    // field-ref: _renderValue проверяет isHoleRef до getIdentifierForSql).
    super(null as unknown as KadmiumSqb, slotName, '');
  }
}

/** Плоский слот: тип значения не выводится, eq-проверка намеренно пропускается (План 3). */
export function slot<const Name extends string>(
  name: Name,
): SlotMarker<Name, any> {
  return new SlotMarker(name);
}

/** Duck-typed guard: распознаёт слот-маркер без импорта из sql-pg. */
export function isHoleRef(v: unknown): v is HoleRef {
  return (
    !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'slot'
  );
}
