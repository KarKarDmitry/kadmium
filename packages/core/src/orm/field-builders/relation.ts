import { KadmiumSqb, type IncludedRelation } from '../sqb';
import type { WhereCondition } from '../ast/where';
import { SelectableField } from '../ast/selectable';
import type { FieldIR, ModelIR } from '../../ir/index';
import { toSnakeCase } from '../../ir/index';
import { createFilter, type NullableFilter } from './factory';
import { BaseFilter } from './base-filter';
import type {
  OrderField,
  OrderProxy,
  FilterProxy as RealFilterProxy,
  RelationProxy,
  SelectProxy,
} from '../types/proxy';

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

// ── RelationBuilder base class ──

/**
 * RelationBuilder — базовый класс для include-связей.
 */
export class RelationBuilder<
  TModel extends { ['~shape']: Record<string, unknown> } = {
    ['~shape']: Record<string, never>;
  },
  TName extends string = string,
  TAlias extends string = TName,
  TParentAlias extends string = string,
> {
  public internalSqb: KadmiumSqb;
  public readonly originalName: TName;
  public alias: TAlias;
  public readonly parentField: string;
  public readonly childField: string;
  /** Parent alias (для multi-запросов) */
  public readonly parentAlias: TParentAlias;
  /** Phantom: выбранные поля (для type-level) */
  declare readonly _selects: unknown;

  constructor(
    protected parentSqb: KadmiumSqb,
    name: TName,
    public readonly targetIr: ModelIR,
    alias?: TAlias,
    /** Опциональная функция для поиска IR связанной модели по имени */
    public readonly irLookup?: (name: string) => ModelIR | undefined,
    /** Parent alias (для multi-запросов) */
    parentAlias?: TParentAlias,
  ) {
    this.originalName = name;
    this.alias = (alias ?? name) as TAlias;
    this.parentAlias = (parentAlias ?? alias ?? name) as TParentAlias;
    this.internalSqb = new KadmiumSqb();
    this.internalSqb.tableContext.set(this.alias, targetIr.name);

    // parentField/childField заполняются в resolveInclude
    this.parentField = '';
    this.childField = 'id';
  }

  as<A extends string>(alias: A): any {
    const clone = this.internalSqb.clone();
    clone.tableContext.delete(this.alias);
    clone.tableContext.set(alias, this.targetIr.name);
    this.internalSqb = clone;
    this.alias = alias as unknown as TAlias;
    return this;
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
    this.internalSqb.orders.push({ field: field.fieldName, direction: dir });
    return this;
  }

  limit(n: number): this {
    this.internalSqb.limit = n;
    return this;
  }

  /** Вложенный include */
  include(
    fn: (
      ...args: any[]
    ) => readonly IRelationBuilder<any, any, any, any, any>[],
  ): any {
    const proxy = this._createRelationProxy();
    const builders = fn(proxy);
    for (const builder of builders) {
      this.internalSqb.includes.push(this._resolveInclude(builder as any));
    }
    return this;
  }

  /** Превратить этот RelationBuilder в IncludedRelation */
  resolveInclude(
    parentAlias: string,
    fieldIr: FieldIR | undefined,
  ): IncludedRelation {
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
      parentField = 'id'; // FK родителя (PK текущей таблицы)
      childField = fieldIr?.foreignKey ?? '';
    }

    return {
      parentAlias,
      propertyName: this.alias,
      relationType,
      targetIr: this.targetIr,
      parentField,
      childField,
      internalSqb: this.internalSqb,
    };
  }

  protected _createFilterProxy(): Record<string, BaseFilter | NullableFilter> {
    const alias = this.alias;
    const ir = this.targetIr;
    const sqb = this.internalSqb;
    return new Proxy({} as Record<string, BaseFilter | NullableFilter>, {
      get: (_, field: string) => {
        const fieldIr = ir.fields[field];
        if (!fieldIr)
          throw new Error(`Field "${field}" not found in ${ir.name}`);
        return createFilter(sqb, field, alias, fieldIr);
      },
    });
  }

  protected _createFieldProxy(): SelectProxy<TModel> {
    const alias = this.alias;
    return new Proxy({} as SelectProxy<TModel>, {
      get: (_, field: string) => new SelectableField(alias, field),
    });
  }

  private _createOrderProxy(): OrderProxy<TModel> {
    const alias = this.alias;
    return new Proxy({} as OrderProxy<TModel>, {
      get: (_, field: string) => ({
        tableAlias: alias,
        fieldName: field as string,
      }),
    });
  }

  /** Создаёт прокси для вложенных include */
  protected _createRelationProxy(): Record<string, RelationBuilder> {
    const sqb = this.internalSqb;
    const ir = this.targetIr;
    const lookup = this.irLookup;
    return new Proxy({} as Record<string, RelationBuilder>, {
      get: (_, name: string) => {
        const fieldIr = ir.fields[name];
        if (!fieldIr || fieldIr.type !== 'ref')
          throw new Error(`Relation "${name}" not found in ${ir.name}`);
        const targetName = fieldIr.sourceModel ?? fieldIr.ref ?? name;
        const targetIr: ModelIR = lookup?.(targetName) ?? {
          name: targetName,
          collection: toSnakeCase(targetName),
          fields: {},
        };
        const isToMany =
          !!fieldIr.sourceModel && fieldIr.relation === 'one-to-many';
        return isToMany
          ? new ToManyRelationBuilder(sqb, name, targetIr, undefined, lookup)
          : new ToOneRelationBuilder(sqb, name, targetIr, undefined, lookup);
      },
    });
  }

  /** Превращает дочерний RelationBuilder в IncludedRelation для internalSqb */
  protected _resolveInclude(builder: RelationBuilder): IncludedRelation {
    const fieldIr = this.targetIr.fields[builder.originalName];
    return builder.resolveInclude(this.alias, fieldIr);
  }
}

// ── ToOneRelationBuilder ──

export class ToOneRelationBuilder<
  T extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  } = {
    ['~shape']: Record<string, never>;
    ['~rel']: Record<string, never>;
  },
  TParent extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  } = { ['~shape']: Record<string, never>; ['~rel']: Record<string, never> },
  TName extends string = string,
  TAlias extends string = TName,
  TNested extends readonly IRelationBuilder<any, any, any, any, any>[] = [],
  TParentAlias extends string = string,
  TSelects = never,
> extends RelationBuilder<T, TName, TAlias, TParentAlias> {
  /** Phantom: список вложенных include для рекурсивного типа */
  declare readonly __nested?: TNested;
  /** Phantom: явно выбранные поля (когда вызывается .select() на builder) */
  declare readonly _selects: TSelects;

  /** Переименовать с новым TAlias */
  as<A extends string>(
    alias: A,
  ): ToOneRelationBuilder<
    T,
    TParent,
    TName,
    A,
    TNested,
    TParentAlias,
    TSelects
  > {
    super.as(alias);
    return this as any;
  }

  /** Вложенный include с аккумуляцией TNested */
  include<const R extends readonly IRelationBuilder<any, any, any, any, any>[]>(
    fn: (t: RelationProxy<T>) => R,
  ): ToOneRelationBuilder<
    T,
    TParent,
    TName,
    TAlias,
    [...TNested, ...R],
    TParentAlias,
    TSelects
  > {
    super.include(fn as any);
    return this as any;
  }
}

// ── ToManyRelationBuilder ──

export class ToManyRelationBuilder<
  T extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  } = {
    ['~shape']: Record<string, never>;
    ['~rel']: Record<string, never>;
  },
  TParent extends {
    ['~shape']: Record<string, unknown>;
    ['~rel']: Record<string, unknown>;
  } = { ['~shape']: Record<string, never>; ['~rel']: Record<string, never> },
  TName extends string = string,
  TAlias extends string = TName,
  TNested extends readonly IRelationBuilder<any, any, any, any, any>[] = [],
  TParentAlias extends string = string,
  TSelects = never,
> extends RelationBuilder<T, TName, TAlias, TParentAlias> {
  /** Phantom: список вложенных include для рекурсивного типа */
  declare readonly __nested?: TNested;
  /** Phantom: явно выбранные поля (когда вызывается .select() на builder) */
  declare readonly _selects: TSelects;

  /** Переименовать с новым TAlias */
  as<A extends string>(
    alias: A,
  ): ToManyRelationBuilder<
    T,
    TParent,
    TName,
    A,
    TNested,
    TParentAlias,
    TSelects
  > {
    super.as(alias);
    return this as any;
  }

  /** Вложенный include с аккумуляцией TNested */
  include<const R extends readonly IRelationBuilder<any, any, any, any, any>[]>(
    fn: (t: RelationProxy<T>) => R,
  ): ToManyRelationBuilder<
    T,
    TParent,
    TName,
    TAlias,
    [...TNested, ...R],
    TParentAlias,
    TSelects
  > {
    super.include(fn as any);
    return this as any;
  }
}
