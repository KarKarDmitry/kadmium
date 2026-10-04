export type _FieldMeta = {
  readonly _: 'field';
  readonly _type: string;
};

export type _DBOptions = {
  index: boolean;
  unique: boolean;
  nullable: boolean;
  db_type?: string;
  /** `datetime` хранить как `timestamptz` (инстант), а не как местную строку. */
  tz?: boolean;
};

export interface StandardField {
  _meta: _FieldMeta;
  db: _DBOptions;
  /** Имя колонки в БД (по умолчанию — имя поля на модели) */
  alias?: string;
  /** TypeScript-тип поля для кодогенерации */
  tsType?: string;
}
