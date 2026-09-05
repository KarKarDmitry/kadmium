import { KadmiumSqb, type IncludedRelation } from '../sqb';
import type { WhereCondition } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import type { FieldIR, ModelIR } from '../../ir/index';
import { type NullableFilter } from './factory';
import { BaseFilter } from './base-filter';
import type {
  OrderField,
  OrderProxy,
  FilterProxy as RealFilterProxy,
  RelationProxy,
  SelectProxy,
} from '../types/proxy';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
  createRelationProxy,
  type RelationFactory,
} from '../builders/query-proxies';

// ── IRelationBuilder interface ──

/**
 * Phantom interface for compile-time type inference of include chains.
 * Carries the relation name, alias, nested includes, parent alias, and explicit selects.
 */
export interface IRelationBuilder<
  TName extends string = string,
  TAlias extends string = TName,
  TNested extends readonly IRelationBuilder<any, any, any, any, any>[] = [],
  TParentAlias extends string = string,
  TSelects = never,
> {
  readonly originalName: TName;
  readonly alias: TAlias;
  readonly parentAlias: TParentAlias;
  readonly internalSqb: KadmiumSqb;
  readonly _selects: TSelects;
  readonly __nested?: TNested;
}

/**
 * Единое представление include-связи: одновременно и билдер (DSL + фантомные
 * типы для вывода IncludeResult), и рантайм-структура, которую читает
 * SQL-генератор (implements IncludedRelation). Метаданные связи
 * (relationType/parentField/childField) вычисляются в конструкторе из fieldIr,
 * поэтому отдельного шага resolveInclude нет.
 */
export class Relation<
  TModel extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  } = { ['~shape']: Record<string, never>; ['~rel']: Record<string, never> },
  TName extends string = string,
  TAlias extends string = TName,
  TNested extends readonly IRelationBuilder<any, any, any, any, any>[] = [],
  TParentAlias extends string = string,
  TSelects = never,
>
  implements
    IRelationBuilder<TName, TAlias, TNested, TParentAlias, TSelects>,
    IncludedRelation
{
  public internalSqb: KadmiumSqb;
  public readonly originalName: TName;
  public alias: TAlias;
  public readonly parentAlias: TParentAlias;
  public readonly relationType: 'one-to-one' | 'one-to-many' | 'many-to-one';
  public readonly parentField: string;
  public readonly childField: string;
  /** Phantom: выбранные поля (для type-level) */
  declare readonly _selects: TSelects;
  /** Phantom: список вложенных include для рекурсивного типа */
  declare readonly __nested?: TNested;

  constructor(
    protected parentSqb: KadmiumSqb,
    name: TName,
    public readonly targetIr: ModelIR,
    fieldIr: FieldIR | undefined,
    /** Опциональная функция для поиска IR связанной модели по имени */
    public readonly irLookup?: (name: string) => ModelIR | undefined,
    /** Parent alias (для multi-запросов) */
    parentAlias?: TParentAlias,
  ) {
    this.originalName = name;
    this.alias = name as unknown as TAlias;
    this.parentAlias = (parentAlias ?? name) as TParentAlias;

    let parentField = fieldIr?.foreignKey ?? '';
    let childField = 'id';
    const relationType: 'one-to-one' | 'one-to-many' | 'many-to-one' =
      fieldIr?.sourceModel
        ? 'one-to-many'
        : fieldIr?.relation === 'one-to-one'
          ? 'one-to-one'
          : 'many-to-one';
    // Для обратных связей (one-to-many): parentField = PK, childField = FK
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

  /** Ключ в результате — совпадает с alias (для IncludedRelation). */
  get propertyName(): string {
    return this.alias as string;
  }

  as<A extends string>(
    alias: A,
  ): Relation<TModel, TName, A, TNested, TParentAlias, TSelects> {
    const clone = this.internalSqb.clone();
    clone.tableContext.delete(this.alias);
    clone.tableContext.set(alias, this.targetIr.name);
    this.internalSqb = clone;
    this.alias = alias as unknown as TAlias;
    return this as any;
  }

  where(fn: (t: RealFilterProxy<TModel>) => WhereCondition): this {
    const condition = fn(this._createFilterProxy() as RealFilterProxy<TModel>);
    this.internalSqb.wheres.conditions.push(condition);
    return this;
  }

  order(
    fn: (t: OrderProxy<TModel>) => OrderField,
    dir: 'asc' | 'desc' = 'asc',
  ): this {
    const field = fn(this._createOrderProxy());
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

  /** Явно выбрать поля связи. */
  select(fn: (t: SelectProxy<TModel>) => readonly SelectableField[]): this {
    this.internalSqb.selects = [...fn(this._createFieldProxy())];
    return this;
  }

  /** Вложенный include: дочерний Relation пушится прямо в internalSqb.includes. */
  include<const R extends readonly IRelationBuilder<any, any, any, any, any>[]>(
    fn: (t: RelationProxy<TModel>) => R,
  ): Relation<
    TModel,
    TName,
    TAlias,
    [...TNested, ...R],
    TParentAlias,
    TSelects
  > {
    const proxy = this._createRelationProxy();
    const builders = fn(proxy);
    for (const builder of builders) {
      this.internalSqb.includes.push(builder as any);
    }
    return this as any;
  }

  protected _createFilterProxy(): Record<string, BaseFilter | NullableFilter> {
    return createFilterProxy(
      this.alias,
      this.targetIr,
      this.internalSqb,
    ) as unknown as Record<string, BaseFilter | NullableFilter>;
  }

  protected _createFieldProxy(): SelectProxy<TModel> {
    return createSelectProxy(this.alias, this.targetIr);
  }

  private _createOrderProxy(): OrderProxy<TModel> {
    return createOrderProxy(this.alias, this.targetIr);
  }

  /** Создаёт прокси для вложенных include */
  protected _createRelationProxy(): RelationProxy<TModel> {
    return createRelationProxy(
      this.alias,
      this.targetIr,
      this.internalSqb,
      Relation as unknown as RelationFactory,
      this.irLookup,
    );
  }
}
