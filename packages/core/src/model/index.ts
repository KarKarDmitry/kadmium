import f from './fields/index';
import { invertRelation } from './fields/model';
import type { ModelSchema, ModelRelation } from './types/model';
import type { StandardField } from './types/_base';
import type { ReferenceField } from './types/ref';
import type { AbstractFieldBuilder } from './fields/_base';

export type ModelClass = typeof Model;

/** Маркер для безопасной проверки isModelClass */
export const MODEL_MARKER = Symbol.for('kadmium:model');

export class Model {
  /** Реестр моделей для разрешения связей */
  private static registry = new Map<string, ModelClass>();
  /** Маркер для isModelClass() — без инстанцирования */
  static readonly [MODEL_MARKER] = true;

  /**
   * Зарегистрировать классы моделей в реестре.
   * Нужно для разрешения целевого класса модели в `$relations()` и валидации `$build()`.
   */
  static register(...models: ModelClass[]) {
    for (const m of models) {
      this.registry.set(m.name, m);
    }
  }

  /** Найти класс модели по имени */
  static resolve(name: string): ModelClass | undefined {
    return this.registry.get(name);
  }

  /** Все зарегистрированные классы моделей */
  static get models(): ModelClass[] {
    return [...this.registry.values()];
  }

  /**
   * По умолчанию использует bigint с автоинкрементом.
   * Можно переопределить в наследниках.
   */
  /** @default f.pk (bigint auto-increment) */
  id: AbstractFieldBuilder = f.pk;

  /** Собрать схему модели */
  $build(): ModelSchema {
    const fields: Record<string, StandardField> = {};

    for (const key of Object.keys(this)) {
      const val = (this as Record<string, unknown>)[key];
      if (
        val &&
        typeof (val as StandardFieldBuilderLike).$build === 'function'
      ) {
        const built = (val as StandardFieldBuilderLike).$build();

        // Все поля: alias по умолчанию = имя поля
        const withAlias = {
          ...built,
          alias: built.alias ?? key,
        };

        // Ref-поля: foreignKey = alias (имя колонки в БД)
        if (withAlias._meta._type === 'ref') {
          const refField = withAlias as ReferenceField;
          fields[key] = {
            ...refField,
            foreignKey: refField.foreignKey ?? refField.alias,
          } as StandardField;
          continue;
        }

        fields[key] = withAlias;
      }
    }

    return {
      _meta: { _: 'model', name: this.constructor.name },
      fields,
    };
  }

  /** Получить список связей модели с другими моделями */
  $relations(): ModelRelation[] {
    const schema = this.$build();
    const relations: ModelRelation[] = [];

    for (const [fieldName, field] of Object.entries(schema.fields)) {
      if (field._meta._type === 'ref') {
        const refField = field as ReferenceField;

        // Валидация: целевая модель должна быть зарегистрирована
        const target = Model.resolve(refField.ref);
        if (!target) {
          console.warn(
            `[Model] ${this.constructor.name}.${fieldName}: target model "${refField.ref}" is not registered. Call Model.register().`,
          );
        }

        relations.push({
          field: fieldName,
          ref: refField.ref,
          relation: refField.relation,
          targetModel: target,
          foreignKey: refField.foreignKey,
          inverse: refField.inverse,
          inverseRelation: invertRelation(refField.relation),
        });
      }
    }

    return relations;
  }

  /** Найти модели, которые ссылаются на эту (обратные связи) */
  $refs(): ModelRelation[] {
    const myName = this.constructor.name;
    const refs: ModelRelation[] = [];

    for (const ModelClass of Model.registry.values()) {
      if (ModelClass === this.constructor) continue;

      const instance = new (ModelClass as new () => Model)();
      for (const rel of instance.$relations()) {
        if (rel.ref === myName) {
          refs.push({
            field: rel.field,
            ref: rel.ref,
            sourceModel: ModelClass.name,
            relation: rel.inverseRelation,
            targetModel: this.constructor as unknown as { name: string },
            foreignKey: rel.foreignKey,
            inverse: rel.inverse ?? rel.field,
            inverseRelation: rel.relation,
          });
        }
      }
    }

    return refs;
  }
}

interface StandardFieldBuilderLike {
  $build(): StandardField;
}
