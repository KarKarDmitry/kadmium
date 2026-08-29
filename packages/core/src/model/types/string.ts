import type { StandardField } from './_base';

export interface StringField_Spec {
  default?: string;
  min?: number;
  max?: number;
}

export interface StringField extends StandardField {
  _meta: { _: 'field'; _type: 'string' };
  spec?: StringField_Spec;
  tsType: 'string';
}
