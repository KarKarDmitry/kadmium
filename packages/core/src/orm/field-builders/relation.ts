import { KadmiumSqb, type IncludedRelation } from '../sqb';
import type { WhereCondition } from '../ast/where';
import type { FieldIR, ModelIR } from '../../ir/index';
import type { OrderField } from '../types/proxy';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
} from '../builders/query-proxies';
import { SelectableField } from '../ast/selectable';
import { buildRelation, configureRelation } from '../builders/include-utils';

/**
 * Relation — runtime класс для include связей.
 * Несёт metadata (relationType, parentField, childField) и internalSqb.
 * Типы вычисляются на уровне IncludeConfig, не на уровне generic параметров класса.
 */
export class Relation implements IncludedRelation {
  public internalSqb: KadmiumSqb;
  public readonly originalName: string;
  public alias: string;
  public readonly parentAlias: string;
  public readonly relationType: 'one-to-one' | 'one-to-many' | 'many-to-one';
  public readonly parentField: string;
  public readonly childField: string;

  constructor(
    protected parentSqb: KadmiumSqb,
    name: string,
    public readonly targetIr: ModelIR,
    fieldIr: FieldIR | undefined,
    public readonly irLookup?: (name: string) => ModelIR | undefined,
    parentAlias?: string,
  ) {
    this.originalName = name;
    this.alias = name;
    this.parentAlias = parentAlias ?? name;

    let parentField = fieldIr?.foreignKey ?? '';
    let childField = 'id';
    const relationType: 'one-to-one' | 'one-to-many' | 'many-to-one' =
      fieldIr?.sourceModel
        ? 'one-to-many'
        : fieldIr?.relation === 'one-to-one'
          ? 'one-to-one'
          : 'many-to-one';

    if (relationType === 'one-to-many') {
      parentField = 'id';
      childField = fieldIr?.foreignKey ?? '';
    }
    this.relationType = relationType;
    this.parentField = parentField;
    this.childField = childField;

    this.internalSqb = new KadmiumSqb();
    this.internalSqb.tableContext.set(this.alias, targetIr.name);
  }

  get propertyName(): string {
    return this.alias;
  }

  as(alias: string): this {
    const clone = this.internalSqb.clone();
    clone.tableContext.delete(this.alias);
    clone.tableContext.set(alias, this.targetIr.name);
    this.internalSqb = clone;
    this.alias = alias;
    return this;
  }

  where(fn: (t: any) => WhereCondition): this {
    const proxy = createFilterProxy(
      this.alias,
      this.targetIr,
      this.internalSqb,
    );
    const condition = fn(proxy);
    this.internalSqb.wheres.conditions.push(condition);
    return this;
  }

  order(fn: (t: any) => OrderField, dir: 'asc' | 'desc' = 'asc'): this {
    const proxy = createOrderProxy(this.alias, this.targetIr);
    const field = fn(proxy);
    this.internalSqb.orders.push({
      field: field.fieldName,
      column: field.column,
      direction: dir,
    });
    return this;
  }

  limit(n: number): this {
    this.internalSqb.limit = n;
    return this;
  }

  select(fn: (t: any) => readonly SelectableField[]): this {
    const proxy = createSelectProxy(this.alias, this.targetIr);
    this.internalSqb.selects = [...fn(proxy)];
    return this;
  }

  /** Вложенный include через Record config */
  include(config: Record<string, any>): this {
    for (const [relationName, relationConfig] of Object.entries(config)) {
      const builder = buildRelation(
        this.internalSqb,
        this.targetIr,
        relationName,
        this.irLookup,
        this.alias,
      );
      configureRelation(this.internalSqb, builder, relationConfig);
    }
    return this;
  }
}
