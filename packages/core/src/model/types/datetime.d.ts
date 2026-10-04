import type { StandardField } from './_base';

/**
 * Значения спецификации — по типу самого поля.
 *
 * `datetime` работает с `Date`, а `date` и `time` — со строками ISO
 * (`YYYY-MM-DD` и `HH:MM:SS`). Драйвер отдаёт и принимает именно строки, и
 * у `date`/`time` в строке нет компонента, который можно потерять, так что
 * `Date` здесь был лишним преобразованием: он терял календарный день на
 * границе локальной зоны.
 */
export interface BaseDateTimeField_Spec<TValue = Date> {
  default?: TValue;
  min?: TValue;
  max?: TValue;
}

export interface BaseDateTimeField<
  TValue = Date | string,
> extends StandardField {
  _meta: { _: 'field'; _type: 'time' };
  type: 'datetime' | 'date' | 'time' | '_';
  spec?: BaseDateTimeField_Spec<TValue>;
  tsType: 'Date' | 'string';
}

/** `f.datetime` — инстант, локальная зона процесса. */
export interface DateTimeField extends BaseDateTimeField<Date> {
  type: 'datetime';
  tsType: 'Date';
}

/** `f.datetime.date` — календарный день, строка `YYYY-MM-DD`. */
export interface DateField extends BaseDateTimeField<string> {
  type: 'date';
  tsType: 'string';
}

/** `f.datetime.time` — время суток, строка `HH:MM:SS[.sss]`. */
export interface TimeField extends BaseDateTimeField<string> {
  type: 'time';
  tsType: 'string';
}
