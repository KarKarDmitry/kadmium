import { StandartFieldBuilder } from './_base';
import type { BooleanField } from '../types/boolean';

export class BooleanFieldBuilder extends StandartFieldBuilder {
  private spec: { default: boolean } = { default: false };

  default(val: boolean) {
    this.spec.default = val;
    return this;
  }

  $build(): BooleanField {
    const base = super.$build();
    return {
      ...base,
      _meta: { _: 'field', _type: 'boolean' },
      spec: this.spec,
      tsType: 'boolean',
    };
  }
}
