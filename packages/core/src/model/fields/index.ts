import { BooleanFieldBuilder } from './boolean';
import { DateTimeFieldBuilder } from './datetime';
import { NumberFieldBuilder } from './number';
import { PrimaryFieldBuilder } from './primary';
import { ReferenceFieldBuilder } from './ref';
import { StringFieldBuilder } from './string';

export default {
  get string() {
    return new StringFieldBuilder();
  },
  get bool() {
    return new BooleanFieldBuilder();
  },
  /**
   * @description
   * Uses int on default
   */
  get number() {
    return new NumberFieldBuilder();
  },
  /**
   * @description
   * Uses bigint on default
   */
  get pk() {
    return new PrimaryFieldBuilder();
  },
  /**
   * @description
   * Uses datetime on default
   */
  get datetime() {
    return new DateTimeFieldBuilder();
  },
  get ref() {
    return new ReferenceFieldBuilder();
  },
};
