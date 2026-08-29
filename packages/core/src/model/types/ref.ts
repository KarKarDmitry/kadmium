import type { StandardField } from './_base';
import type { RelationType } from './model';

// Ref tsType = имя целевой модели (динамически, от билдера)

export interface ReferenceField extends StandardField {
  _meta: { _: 'field'; _type: 'ref' };
  ref: string;
  relation: RelationType;
  tsType: string;
  /** Имя поля обратной связи на целевой модели */
  inverse?: string;
  /** Имя FK-колонки в БД (по умолчанию — имя поля) */
  foreignKey?: string;
}
