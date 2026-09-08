import type { WhereCondition, WhereGroup } from './ast/where';
import { createWhereGroup } from './ast/where';
import type { SelectableField } from './ast/selectable';
import { AggregateField } from './ast/aggregate';

/** Поле в SELECT: обычное или агрегатное */
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
    c.selects = this.selects ? this._cloneSelects(this.selects) : null;
    c.joins = [...this.joins];
    c.includes = [...this.includes];
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
      op: g.op,
      conditions: g.conditions.map((c) => {
        if ('conditions' in c) return this._cloneWhereGroup(c);
        return { ...c };
      }),
    };
  }

  /**
   * Deep-copy selects: SelectableField immutable — можно шарить,
   * AggregateField.as() мутирует alias — копируем.
   */
  private _cloneSelects(selects: AnySelectableField[]): AnySelectableField[] {
    return selects.map((s) => {
      if (s.kind !== 'aggregate') return s;
      const agg = new AggregateField(s.func, s.field);
      agg.alias = s.alias;
      return agg;
    });
  }
}
