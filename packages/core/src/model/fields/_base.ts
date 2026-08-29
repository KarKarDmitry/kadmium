import type { StandardField, _DBOptions } from '../types/_base';

export abstract class AbstractFieldBuilder {
  abstract $build(): StandardField;
}

export class StandartFieldBuilder implements AbstractFieldBuilder {
  protected db: _DBOptions = {
    index: false,
    unique: false,
    nullable: true,
  };
  protected columnAlias?: string;

  index() {
    this.db.index = true;
    return this;
  }

  unique() {
    this.db.unique = true;
    return this;
  }

  notNull() {
    this.db.nullable = false;
    return this;
  }

  /**
   * Указать другое имя колонки в БД.
   * По умолчанию — имя поля на модели.
   */
  alias(columnName: string) {
    this.columnAlias = columnName;
    return this;
  }

  $build(): StandardField {
    return {
      _meta: { _: 'field', _type: '_' },
      db: this.db,
      ...(this.columnAlias ? { alias: this.columnAlias } : {}),
    };
  }
}
