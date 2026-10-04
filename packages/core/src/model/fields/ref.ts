import { StandartFieldBuilder } from './_base';
import type { ReferenceField } from '../types/ref';
import { invertRelation } from '../fields/model';
import type { RelationType } from '../types/model';
import {
  REFERENTIAL_ACTION_INPUTS,
  type ReferentialActionInput,
} from '../../ir/index';

export class ReferenceFieldBuilder extends StandartFieldBuilder {
  private targetModel?: string;
  private relation: RelationType = 'one-to-many';
  private inverseField?: string;
  private foreignKeyField?: string;
  private onDeleteAction?: ReferentialActionInput;
  private onUpdateAction?: ReferentialActionInput;

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

  /**
   * Что делать с этой строкой при удалении строки на целевой модели.
   *
   * Ставится на поле, которое владеет FK-колонкой, — то есть на той модели,
   * где FK физически существует. `Comment.post.onDelete('cascade')` удалит
   * комментарий вместе с постом; действие на обратной стороне связи задавать
   * некуда, потому что FK живёт здесь.
   *
   * @param action — `no action` (по умолчанию в БД), `cascade`, `set null`,
   *   `restrict`, `set default`. `set null` требует nullable-колонки: `.notNull()`
   *   вместе с ним бросает ошибку на `$build()`, потому что Postgres отвергает
   *   такой FK при создании. `set default` требует DEFAULT у FK-колонки.
   */
  onDelete(action: ReferentialActionInput) {
    this.onDeleteAction = action;
    return this;
  }

  /**
   * Что делать с этой строкой при изменении строки на целевой модели.
   *
   * По умолчанию `no action`: смена PK родителя ломает ссылки. `cascade` здесь
   * опасен — `orm.update(User).set({ id })` молча перепишет FK-колонку у всех
   * детей в одной транзакции.
   */
  onUpdate(action: ReferentialActionInput) {
    this.onUpdateAction = action;
    return this;
  }

  $build(): ReferenceField {
    if (!this.targetModel) {
      throw new Error(
        'ReferenceFieldBuilder: target model is not set. Call .target(ModelClass).',
      );
    }

    this.assertAction('onDelete', this.onDeleteAction);
    this.assertAction('onUpdate', this.onUpdateAction);
    this.assertSetNullNullable('onDelete', this.onDeleteAction);
    this.assertSetNullNullable('onUpdate', this.onUpdateAction);

    const base = super.$build();
    return {
      ...base,
      _meta: { _: 'field', _type: 'ref' },
      ref: this.targetModel,
      relation: this.relation,
      // tsType не задаём: у FK-колонки он равен tsType целевого PK, который
      // резолвится в compileModel. Имя модели здесь было импорт-хаком для
      // кодгена и попадало в `~shape` как 'number' у любого PK (B8).
      ...(this.foreignKeyField ? { foreignKey: this.foreignKeyField } : {}),
      ...(this.inverseField ? { inverse: this.inverseField } : {}),
      ...(this.onDeleteAction ? { onDelete: this.onDeleteAction } : {}),
      ...(this.onUpdateAction ? { onUpdate: this.onUpdateAction } : {}),
    };
  }

  private assertAction(
    kind: 'onDelete' | 'onUpdate',
    action: ReferentialActionInput | undefined,
  ) {
    if (action === undefined) return;
    if (REFERENTIAL_ACTION_INPUTS.includes(action)) return;
    throw new Error(
      `ReferenceFieldBuilder: unknown ${kind} action "${action}". Use one of: ${REFERENTIAL_ACTION_INPUTS.join(', ')}.`,
    );
  }

  private assertSetNullNullable(
    kind: 'onDelete' | 'onUpdate',
    action: ReferentialActionInput | undefined,
  ) {
    if (this.db.nullable) return;
    if (action !== 'set null') return;
    throw new Error(
      `ReferenceFieldBuilder: ${kind}('set null') needs a nullable field. ` +
        'The FK column would reject NULL, and Postgres refuses the constraint. ' +
        'Drop .notNull() or pick another action.',
    );
  }

  /** Тип обратной связи */
  get inverseRelation(): RelationType {
    return invertRelation(this.relation);
  }
}
