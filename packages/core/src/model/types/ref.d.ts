import type { StandardField } from './_base';
import type { RelationType } from './model';
import type { ReferentialActionInput } from '../../ir/index';

// tsType не объявляется: у FK-колонки он равен tsType целевого PK, который
// резолвит compileModel. Раньше здесь лежало имя модели — и кодген использовал
// его, чтобы решить, нужен ли импорт, а в `~shape` подставлял 'number' (B8).

export interface ReferenceField extends StandardField {
  _meta: { _: 'field'; _type: 'ref' };
  ref: string;
  relation: RelationType;
  /** Имя поля обратной связи на целевой модели */
  inverse?: string;
  /** Имя FK-колонки в БД (по умолчанию - имя поля) */
  foreignKey?: string;
  /** ON DELETE для FK-колонки этого поля; отсутствует - 'no action' */
  onDelete?: ReferentialActionInput;
  /** ON UPDATE для FK-колонки этого поля; отсутствует - 'no action' */
  onUpdate?: ReferentialActionInput;
}
