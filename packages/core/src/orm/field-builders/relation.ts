import { KadmiumSqb, type IncludedRelation, orderToStep } from '../sqb';
import type { WhereExpression } from '../ast/where';
import type { FieldIR, ModelIR } from '../../ir/index';
import type { OrderDirection } from '../types/proxy';
import {
  toSqlCondition,
  type SqlFragment,
  type SqlOrder,
} from '../sql-fragment';
import {
  createFilterProxy,
  createSelectProxy,
  createOrderProxy,
} from '../builders/query-proxies';
import { SelectableField } from '../ast/selectable';
import {
  buildRelation,
  configureRelation,
  type IncludeConfigValue,
} from '../builders/include-utils';

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
    /** IR модели, которой принадлежит поле связи — базовой для include. */
    parentIr?: ModelIR,
  ) {
    this.originalName = name;
    this.alias = name;
    this.parentAlias = parentAlias ?? name;

    // JOIN строится как `"<alias связи>"."childField" = "<родитель>"."parentField"`,
    // поэтому `childField` — колонка включаемой модели (`targetIr`), а
    // `parentField` — колонка базовой. Это разные модели, поэтому PK берётся
    // у каждой своей: у связи без `sourceModel` FK лежит на базовой модели,
    // у inverse — на включаемой, и PK там нужен родителю, а не цели.
    const isInverse = !!fieldIr?.sourceModel;
    const parentPrimaryKey = parentIr ? primaryKeyColumn(parentIr) : 'id';

    let parentField = fieldIr?.foreignKey ?? '';
    let childField = primaryKeyColumn(targetIr);
    const relationType: 'one-to-one' | 'one-to-many' | 'many-to-one' =
      fieldIr?.relation === 'one-to-one'
        ? 'one-to-one'
        : isInverse
          ? 'one-to-many'
          : 'many-to-one';

    if (isInverse) {
      parentField = parentPrimaryKey;
      childField = fieldIr?.foreignKey ?? '';
    }
    this.relationType = relationType;
    this.parentField = parentField;
    this.childField = childField;

    this.internalSqb = new KadmiumSqb();
    this.internalSqb.tableContext.set(this.alias, targetIr.collection);
  }

  get propertyName(): string {
    return this.alias;
  }

  as(alias: string): this {
    const clone = this.internalSqb.clone();
    clone.tableContext.delete(this.alias);
    clone.tableContext.set(alias, this.targetIr.collection);
    this.internalSqb = clone;
    this.alias = alias;
    return this;
  }

  where(fn: (t: any) => WhereExpression | SqlFragment | undefined): this {
    const proxy = createFilterProxy(
      this.alias,
      this.targetIr,
      this.internalSqb,
    );
    const expression = fn(proxy);
    if (expression !== undefined) {
      this.internalSqb.wheres.elements.push({
        join: 'AND',
        condition: toSqlCondition(expression),
      });
    }
    return this;
  }

  order(fn: (t: any) => OrderDirection[] | SqlOrder<'asc' | 'desc'>[]): this {
    const proxy = createOrderProxy(this.alias, this.targetIr);
    for (const d of fn(proxy)) {
      this.internalSqb.orders.push(orderToStep(d));
    }
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
  include(config: Record<string, IncludeConfigValue>): this {
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

/**
 * Колонка первичного ключа модели — по `isPrimary`, а не по имени `id`.
 *
 * Имя колонки, а не свойства: `parentField`/`childField` уходят в SQL как
 * есть (`"alias"."column"`), поэтому нужен именно `FieldIR.alias`.
 * Раньше здесь стоял литерал `'id'`, и модель с нестандартным PK
 * (`uid = f.pk.uuid`) давала JOIN по несуществующей колонке → PG 42703.
 *
 * Без PK отдаём `'id'`: связи к модели без первичного ключа вырождены, и
 * падать здесь означало бы сломать инициализацию include ради неиспользуемой
 * связи — настоящую ошибку пользователь увидит в самом запросе.
 */
function primaryKeyColumn(ir: ModelIR): string {
  for (const [name, field] of Object.entries(ir.fields)) {
    if (field.isPrimary === true) return field.alias ?? name;
  }
  return 'id';
}
