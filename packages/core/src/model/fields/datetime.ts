import { StandartFieldBuilder } from './_base';
import {
  BaseDateTimeField,
  BaseDateTimeField_Spec,
  DateField,
  TimeField,
  DateTimeField,
} from '../types/datetime';

export abstract class BaseDateTimeFieldBuilder extends StandartFieldBuilder {
  protected spec: BaseDateTimeField_Spec = {};

  default(val: Date) {
    this._validate(val, 'default');
    this.spec.default = val;
    return this;
  }

  min(val: Date) {
    this._validate(val, 'min');
    this.spec.min = val;
    return this;
  }

  max(val: Date) {
    this._validate(val, 'max');
    this.spec.max = val;
    return this;
  }

  protected _validate(_val: Date, _field: string): void {
    // Base: no strict validation
  }

  $build(): BaseDateTimeField {
    const base = super.$build();
    return {
      ...base,
      _meta: { _: 'field', _type: 'time' },
      type: '_',
      spec: this.spec,
      tsType: 'Date',
    };
  }
}

export class DateFieldBuilder extends BaseDateTimeFieldBuilder {
  protected _validate(val: Date, field: string): void {
    if (
      val.getUTCHours() !== 0 ||
      val.getUTCMinutes() !== 0 ||
      val.getUTCSeconds() !== 0 ||
      val.getUTCMilliseconds() !== 0
    ) {
      throw new Error(
        `Date field "${field}" value has time components. Use midnight UTC (00:00:00.000).`,
      );
    }
  }

  $build(): DateField {
    const base = super.$build();
    return { ...base, type: 'date', tsType: 'Date' };
  }
}

export class TimeFieldBuilder extends BaseDateTimeFieldBuilder {
  protected _validate(val: Date, field: string): void {
    if (
      val.getUTCFullYear() !== 1970 ||
      val.getUTCMonth() !== 0 ||
      val.getUTCDate() !== 1
    ) {
      throw new Error(
        `Time field "${field}" value has date components. Use epoch date (1970-01-01).`,
      );
    }
  }

  $build(): TimeField {
    const base = super.$build();
    return { ...base, type: 'time' };
  }
}

export class DateTimeFieldBuilder extends BaseDateTimeFieldBuilder {
  get date() {
    return new DateFieldBuilder();
  }
  get time() {
    return new TimeFieldBuilder();
  }

  $build(): DateTimeField {
    const base = super.$build();
    return { ...base, type: 'datetime' };
  }
}
