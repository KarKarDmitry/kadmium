import type { StandardField } from './_base';

export interface BooleanField extends StandardField {
  _meta: { _: 'field'; _type: 'boolean' };
  spec?: { default: boolean };
  tsType: 'boolean';
}
