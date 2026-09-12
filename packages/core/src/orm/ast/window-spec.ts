/**
 * WindowSpec — спецификация окна (PARTITION BY / ORDER BY / frame). Чистые данные.
 * Иммутабельна: WindowField переприсваивает новый инстанс при модификации.
 * SQL-рендером занимается адаптер (читает partitionBy/orderBy/frame).
 */
import type { OrderDirection } from '../types/proxy';

export type WindowPartitionField = {
  tableAlias: string;
  fieldName: string;
  column?: string;
};

/**
 * Граница фрейма ROWS.
 * Число — смещение строк: 1 → `1 PRECEDING`, 2 → `2 FOLLOWING`.
 * 'unbounded' в стартовой позиции — `UNBOUNDED PRECEDING`; в конечной — `UNBOUNDED FOLLOWING`.
 * 'current' — `CURRENT ROW`.
 */
export type FrameBound = number | 'unbounded' | 'current';

/** Гвард границ фрейма: только ненулевые целые смещения (PG: `0 PRECEDING` невалидно). */
export function assertFrameBound(
  bound: FrameBound,
  position: 'start' | 'end',
): void {
  if (typeof bound === 'number' && (!Number.isInteger(bound) || bound === 0)) {
    throw new Error(
      `ROWS BETWEEN: ${position} offset must be a non-zero integer (got ${bound})`,
    );
  }
}

export class WindowSpec {
  readonly partitionBy: readonly WindowPartitionField[];
  readonly orderBy: readonly OrderDirection[];
  readonly frame: readonly [FrameBound, FrameBound] | null;

  constructor(
    partitionBy: readonly WindowPartitionField[] = [],
    orderBy: readonly OrderDirection[] = [],
    frame: readonly [FrameBound, FrameBound] | null = null,
  ) {
    this.partitionBy = partitionBy;
    this.orderBy = orderBy;
    this.frame = frame;
  }
}
