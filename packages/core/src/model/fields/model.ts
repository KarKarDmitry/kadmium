import { RelationType } from '../types/model';

/** Маппинг прямой связи → обратной */
export function invertRelation(r: RelationType): RelationType {
  const map: Record<RelationType, RelationType> = {
    'one-to-many': 'many-to-one',
    'many-to-one': 'one-to-many',
    'one-to-one': 'one-to-one',
  };
  return map[r];
}
