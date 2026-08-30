import type { StandardField } from './_base';

export interface NumberField_Spec {
  default?: number;
  min?: number;
  max?: number;
}

export interface NumberField extends StandardField {
  _meta: { _: 'field'; _type: 'number' };
  type: 'int' | 'decimal' | '_';
  spec: NumberField_Spec;
  tsType: 'number';
}

export interface IntegerField extends NumberField {
  type: 'int';
}

export interface DecimalField extends NumberField {
  type: 'decimal';
}
