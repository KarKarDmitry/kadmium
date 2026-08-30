import type { StandardField } from './_base';

export interface BaseDateTimeField_Spec {
  default?: Date;
  min?: Date;
  max?: Date;
}

export interface BaseDateTimeField extends StandardField {
  _meta: { _: 'field'; _type: 'time' };
  type: 'datetime' | 'date' | 'time' | '_';
  spec?: BaseDateTimeField_Spec;
  tsType: 'Date';
}

export interface DateTimeField extends BaseDateTimeField {
  type: 'datetime';
  tsType: 'Date';
}

export interface DateField extends BaseDateTimeField {
  type: 'date';
  tsType: 'Date';
}

export interface TimeField extends BaseDateTimeField {
  type: 'time';
  tsType: 'Date';
}
