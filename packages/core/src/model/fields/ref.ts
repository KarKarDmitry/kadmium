import { StandartFieldBuilder } from './_base';
import type { ReferenceField } from '../types/ref';
import { invertRelation } from '../fields/model';
import type { RelationType } from '../types/model';

export class ReferenceFieldBuilder extends StandartFieldBuilder {
  private targetModel?: string;
  private relation: RelationType = 'one-to-many';
  private inverseField?: string;
  private foreignKeyField?: string;

  /**
   * Указать целевую модель.
   * @param inverse — имя поля обратной связи на целевой модели
   */
  target(modelClass: { name: string }, inverse?: string) {
    this.targetModel = modelClass.name;
    this.inverseField = inverse;
    return this;
  }

  /** Указать имя поля обратной связи на целевой модели */
  inverse(fieldName: string) {
    this.inverseField = fieldName;
    return this;
  }

  /**
   * Явно указать имя FK-колонки в БД.
   * По умолчанию — имя поля на модели.
   */
  fk(columnName: string) {
    this.foreignKeyField = columnName;
    return this;
  }

  oneToOne() {
    this.relation = 'one-to-one';
    return this;
  }

  manyToOne() {
    this.relation = 'many-to-one';
    return this;
  }

  $build(): ReferenceField {
    if (!this.targetModel) {
      throw new Error(
        'ReferenceFieldBuilder: target model is not set. Call .target(ModelClass).',
      );
    }

    const base = super.$build();
    return {
      ...base,
      _meta: { _: 'field', _type: 'ref' },
      ref: this.targetModel,
      relation: this.relation,
      tsType: this.targetModel,
      ...(this.foreignKeyField ? { foreignKey: this.foreignKeyField } : {}),
      ...(this.inverseField ? { inverse: this.inverseField } : {}),
    };
  }

  /** Тип обратной связи */
  get inverseRelation(): RelationType {
    return invertRelation(this.relation);
  }
}
