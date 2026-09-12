import type { WhereCondition, WhereGroup } from './ast/where';
import { createWhereGroup } from './ast/where';
import type { SelectableField } from './ast/selectable';
import { AggregateField } from './ast/aggregate';

/** Поле в SELECT: обычное или агрегатное (оконные появятся с F8) */
export type AnySelectableField = SelectableField | AggregateField;
import type { ModelIR } from '../ir/index';

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
  public orders: {
    field: string;
    column?: string;
    direction: 'asc' | 'desc';
  }[] = [];
  public limit: number | null = null;
  public offset: number | null = null;
  /** Cursor-based пагинация: позиция рендерится AND-членом в WHERE */
  public cursor: WhereGroup = createWhereGroup();
  public groupBy: string[] = [];
  /** Data for UPDATE operations */
  public updateData: Record<string, unknown> | null = null;
  /** Data for UPSERT operations */
  public upsertData: Record<string, unknown> | null = null;
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
