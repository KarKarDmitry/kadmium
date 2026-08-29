import type { StringField, StringField_Spec } from '../types/string';
import { StandartFieldBuilder } from './_base';

export class StringFieldBuilder extends StandartFieldBuilder {
  private spec: StringField_Spec = {};

  default(val: string) {
    this.spec.default = val;
    return this;
  }

  min(val: number) {
    this.spec.min = val;
    return this;
  }

  max(val: number) {
    this.spec.max = val;
    return this;
  }

  $build(): StringField {
    const base = super.$build();
    return {
      ...base,
      _meta: { _: 'field', _type: 'string' },
      spec: this.spec,
      tsType: 'string',
    };
  }
}
