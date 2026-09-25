import type { WhereCondition, WhereGroup } from './ast/where';
import { createWhereGroup } from './ast/where';
import type { SelectableField } from './ast/selectable';
import { AggregateField } from './ast/aggregate';
import type { WindowField } from './ast/window-field';
import type { SqlSelectable, SqlOrder } from './sql-fragment';
import type { OrderStep } from '@karkardmitry/kadmium-sql-types';
import type { OrderDirection } from './types/proxy';
import type { ModelIR } from '../ir/index';

/** Поле в SELECT: обычное, агрегатное, оконная функция (F8) или sql-фрагмент (C2). */
export type AnySelectableField =
  | SelectableField
  | AggregateField
  | WindowField
  | SqlSelectable<unknown, string>;

/** Тип связи для include */
export type IncludedRelation = {
  parentAlias: string;
  propertyName: string;
  relationType: 'one-to-one' | 'one-to-many' | 'many-to-one';
  targetIr: ModelIR;
  parentField: string;
  childField: string;
  internalSqb: KadmiumSqb;
  // Вложенные include хранятся в internalSqb
};

/** Опции JOIN */
export type JoinOptions = {
  left: string;
  right: string;
  direction?: 'inner' | 'left' | 'right' | 'outer';
  on: WhereCondition;
};

/**
 * KadmiumSqb — внутренний AST запроса.
 * Мутабельный, накапливает состояние.
 * Каждый RelationBuilder создаёт свой SQB для вложенных include.
 */
export class KadmiumSqb {
  public operation: 'select' | 'update' | 'delete' | 'upsert' = 'select';
  public tableContext: Map<string, string> = new Map(); // alias → table name
  public wheres: WhereGroup = createWhereGroup();
  /** HAVING условия (агрегатные алиасы без префикса таблицы) */
  public havings: WhereGroup = createWhereGroup();
  public selects: AnySelectableField[] | null = null;
  public joins: JoinOptions[] = [];
  public includes: IncludedRelation[] = [];
  public orders: OrderStep[] = [];
  public limit: number | null = null;
  public offset: number | null = null;
  /** Cursor-based пагинация: позиция рендерится AND-членом в WHERE */
  public cursor: WhereGroup = createWhereGroup();
  public groupBy: string[] = [];
  /** Data for UPDATE operations */
  public updateData: Record<string, unknown> | null = null;
  /** Data for UPSERT operations */
  public upsertData: Record<string, unknown> | null = null;
  /** DO UPDATE SET-выражения для ON CONFLICT (F): ключ → значение или SqlValue */
  public upsertSetData: Record<string, unknown> | null = null;
  /** Column(s) for ON CONFLICT clause */
  public conflictTarget: string[] | null = null;
  /** ON CONFLICT DO NOTHING instead of DO UPDATE */
  public doNothing: boolean = false;

  constructor() {}

  /** Клонировать SQB (для .as() в RelationBuilder) */
  clone(): KadmiumSqb {
    const c = new KadmiumSqb();
    c.operation = this.operation;
    c.tableContext = new Map(this.tableContext);
    c.wheres = this._cloneWhereGroup(this.wheres);
    c.havings = this._cloneWhereGroup(this.havings);
    c.cursor = this._cloneWhereGroup(this.cursor);
    c.selects = this.selects ? this._cloneSelects(this.selects) : null;
    c.joins = [...this.joins];
    c.includes = this._cloneIncludes();
    c.orders = [...this.orders];
    c.limit = this.limit;
    c.offset = this.offset;
    c.groupBy = [...this.groupBy];
    c.updateData = this.updateData ? { ...this.updateData } : null;
    c.upsertData = this.upsertData ? { ...this.upsertData } : null;
    c.upsertSetData = this.upsertSetData ? { ...this.upsertSetData } : null;
    c.conflictTarget = this.conflictTarget ? [...this.conflictTarget] : null;
    c.doNothing = this.doNothing;
    return c;
  }

  private _cloneWhereGroup(g: WhereGroup): WhereGroup {
    return {
      elements: g.elements.map((step) => ({
        join: step.join,
        condition:
          'elements' in step.condition
            ? this._cloneWhereGroup(step.condition)
            : { ...step.condition },
      })),
    };
  }

  /**
   * Shallow-copy selects: both SelectableField and AggregateField are
   * now immutable (as() returns new instance), so sharing references is safe.
   */
  private _cloneSelects(selects: AnySelectableField[]): AnySelectableField[] {
    return [...selects];
  }

  /**
   * Deep-copy includes: each IncludedRelation.internalSqb is cloned
   * independently so that mutations on the clone don't affect the original.
   *
   * We construct plain IncludedRelation objects (not spread from Relation)
   * because Relation's `propertyName` is a getter — spread would lose it.
   */
  private _cloneIncludes(): IncludedRelation[] {
    return this.includes.map((inc) => ({
      parentAlias: inc.parentAlias,
      propertyName: inc.propertyName,
      relationType: inc.relationType,
      targetIr: inc.targetIr,
      parentField: inc.parentField,
      childField: inc.childField,
      internalSqb: inc.internalSqb.clone(),
    }));
  }
}

/**
 * Преобразовать OrderDirection | SqlOrder в шаг ORDER BY (OrderStep).
 * Дискриминация по kind (как isSqlFragment) — без instanceof из sql-fragment,
 * чтобы не создавать runtime-цикл sqb → sql-fragment.
 */
export function orderToStep(
  d: OrderDirection | SqlOrder<'asc' | 'desc'>,
): OrderStep {
  return (d as { kind?: string }).kind === 'sql-order'
    ? {
        kind: 'fragment',
        text: (d as SqlOrder<'asc' | 'desc'>).text,
        values: (d as SqlOrder<'asc' | 'desc'>).values,
        slotOrder: (d as SqlOrder<'asc' | 'desc'>).slotOrder,
        direction: (d as SqlOrder<'asc' | 'desc'>).direction,
      }
    : {
        field: (d as OrderDirection).fieldName,
        column: (d as OrderDirection).column,
        tableAlias: (d as OrderDirection).tableAlias,
        direction: (d as OrderDirection).direction,
      };
}
