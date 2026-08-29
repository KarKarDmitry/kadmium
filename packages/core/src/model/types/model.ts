import type { StandardField } from './_base';

export type RelationType = 'one-to-many' | 'many-to-one' | 'one-to-one';

/** Маппинг прямой связи → обратной */
export function invertRelation(r: RelationType): RelationType {
  const map: Record<RelationType, RelationType> = {
    'one-to-many': 'many-to-one',
    'many-to-one': 'one-to-many',
    'one-to-one': 'one-to-one',
  };
  return map[r];
}

export interface ModelSchema {
  _meta: { _: 'model'; name: string };
  fields: Record<string, StandardField>;
}

export interface ModelRelation {
  /** Имя поля, через которое идёт связь */
  field: string;
  /** Имя целевой модели */
  ref: string;
  /** Имя модели-источника (для обратных связей) */
  sourceModel?: string;
  /** Тип прямой связи */
  relation: RelationType;
  /** Класс целевой модели (если зарегистрирован) */
  targetModel?: { name: string };
  /** Имя FK-колонки в БД */
  foreignKey?: string;
  /** Имя поля обратной связи на целевой модели */
  inverse?: string;
  /** Тип обратной связи */
  inverseRelation: RelationType;
}
