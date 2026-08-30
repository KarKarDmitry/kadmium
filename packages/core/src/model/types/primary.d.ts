import type { StandardField } from './_base';

export interface PrimaryField extends StandardField {
  _meta: { _: 'field'; _type: 'primary' };
  type: 'number' | 'string' | 'uuid' | 'bigint' | '_';
  tsType: 'number' | 'string';
}

export interface BigIntPrimaryField extends PrimaryField {
  _meta: { _: 'field'; _type: 'primary' };
  type: 'bigint';
  increment: boolean;
  tsType: 'number';
}

export type StringPrimaryField_Spec = 'auto' | 'input';

export interface StringPrimaryField extends PrimaryField {
  _meta: { _: 'field'; _type: 'primary' };
  type: 'string';
  spec?: StringPrimaryField_Spec;
  tsType: 'string';
}

export interface UUIDPrimaryField extends PrimaryField {
  _meta: { _: 'field'; _type: 'primary' };
  type: 'uuid';
  tsType: 'string';
}
