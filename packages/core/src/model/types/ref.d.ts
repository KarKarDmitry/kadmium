import type { StandardField } from './_base';
import type { RelationType } from './model';
import type { ReferentialActionInput } from '../../ir/index';

// Ref tsType = имя целевой модели (динамически, от билдера)

export interface ReferenceField extends StandardField {
  _meta: { _: 'field'; _type: 'ref' };
  ref: string;
  relation: RelationType;
  tsType: string;
  /** Имя поля обратной связи на целевой модели */
  inverse?: string;
  /** Имя FK-колонки в БД (по умолчанию - имя поля) */
  foreignKey?: string;
  /** ON DELETE для FK-колонки этого поля; отсутствует - 'no action' */
  onDelete?: ReferentialActionInput;
  /** ON UPDATE для FK-колонки этого поля; отсутствует - 'no action' */
  onUpdate?: ReferentialActionInput;
}
