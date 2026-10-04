import { StandartFieldBuilder } from './_base';
import {
  BaseDateTimeField,
  BaseDateTimeField_Spec,
  DateField,
  TimeField,
  DateTimeField,
} from '../types/datetime';

/**
 * `YYYY-MM-DD`. Календарный день без времени: сравнение строк здесь равно
 * сравнению дат, поэтому `date` не нуждается ни в `Date`, ни в арифметике.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM:SS` с необязательными миллисекундами — ровно то, что отдаёт драйвер. */
const TIME_RE = /^\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

/**
 * Базовый билдер времени. Параметр `TValue` — тип значения поля: `Date` для
 * `datetime`, `string` для `date` и `time`. Он же уходит в `spec`, поэтому
 * `default()` на `date` не примет `Date` и наоборот.
 */
export abstract class BaseDateTimeFieldBuilder<
  TValue = Date,
> extends StandartFieldBuilder {
  protected spec: BaseDateTimeField_Spec<TValue> = {};

  default(val: TValue) {
    this._validate(val, 'default');
    this.spec.default = val;
    return this;
  }

  min(val: TValue) {
    this._validate(val, 'min');
    this.spec.min = val;
    return this;
  }

  max(val: TValue) {
    this._validate(val, 'max');
    this.spec.max = val;
    return this;
  }

  protected _validate(_val: TValue, _field: string): void {
    // Base: no strict validation
  }

  $build(): BaseDateTimeField<TValue> {
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

export class DateFieldBuilder extends BaseDateTimeFieldBuilder<string> {
  protected _validate(val: string, field: string): void {
    if (typeof val !== 'string' || !DATE_RE.test(val)) {
      throw new Error(
        `Date field "${field}" value must be a "YYYY-MM-DD" string, got ${JSON.stringify(val)}.`,
      );
    }
  }

  $build(): DateField {
    const base = super.$build();
    return { ...base, type: 'date', tsType: 'string' };
  }
}

export class TimeFieldBuilder extends BaseDateTimeFieldBuilder<string> {
  protected _validate(val: string, field: string): void {
    if (typeof val !== 'string' || !TIME_RE.test(val)) {
      throw new Error(
        `Time field "${field}" value must be an "HH:MM:SS" string, got ${JSON.stringify(val)}.`,
      );
    }
  }

  $build(): TimeField {
    const base = super.$build();
    return { ...base, type: 'time', tsType: 'string' };
  }
}

export class DateTimeFieldBuilder extends BaseDateTimeFieldBuilder<Date> {
  get date() {
    return new DateFieldBuilder();
  }
  get time() {
    return new TimeFieldBuilder();
  }

  /**
   * Хранить как `timestamptz` — момент времени, а не местная строка.
   *
   * Флаг, а не новый IR-тип: `renderDefault` и фильтр ветвятся по
   * `type === 'datetime'`, и с новым типом `timestamptz` они молча ушли бы в
   * ветку по умолчанию. Имя PG-типа остаётся делом адаптера.
   */
  withTimeZone() {
    this.db.tz = true;
    return this;
  }

  $build(): DateTimeField {
    const base = super.$build();
    return { ...base, type: 'datetime', tsType: 'Date' };
  }
}
