import { StandartFieldBuilder } from './_base';
import type {
  NumberField,
  IntegerField,
  DecimalField,
  NumberField_Spec,
} from '../types/number';

export class BaseNumberFieldBuilder extends StandartFieldBuilder {
  private spec: NumberField_Spec = {};

  default(val: number) {
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

  $build(): NumberField {
    const base = super.$build();
    return {
      ...base,
      _meta: { _: 'field', _type: 'number' },
      type: '_',
      spec: this.spec,
      tsType: 'number',
    };
  }
}

export class IntegerFieldBuilder extends BaseNumberFieldBuilder {
  /** Дефолт для целочисленного поля — только целое число. */
  default(val: number) {
    if (!Number.isInteger(val)) {
      throw new Error(
        `IntegerField default must be an integer, got ${val}. Use f.number.decimal for fractional defaults.`,
      );
    }
    super.default(val);
    return this;
  }

  $build(): IntegerField {
    const base = super.$build();
    return { ...base, type: 'int' };
  }
}

export class DecimalFieldBuilder extends BaseNumberFieldBuilder {
  $build(): DecimalField {
    const base = super.$build();
    return { ...base, type: 'decimal' };
  }
}

export class NumberFieldBuilder extends IntegerFieldBuilder {
  get decimal() {
    return new DecimalFieldBuilder();
  }
}
