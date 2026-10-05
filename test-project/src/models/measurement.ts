import { Model, f } from '@karkardmitry/kadmium-core';

/**
 * Модель для проверки приведения значений при чтении (B3/B4).
 *
 * `amount` — `numeric` в PostgreSQL: `pg-types` не ставит ему парсер, поэтому
 * без приведения ORM отдаёт строку вопреки `~shape`, где объявлено число.
 * Дефолтный PK — bigint, а это ровно тот тип, где `Number()` молча округляет
 * всё, что выше 2^53.
 *
 * Модель заведена отдельно от `Post`/`User` намеренно: тесты кладут в неё
 * значения, которые DSL выразить не может (id за 2^53, 17 значащих цифр в
 * numeric), и общая таблица постов заставила бы фильтровать чужие строки.
 */
export class Measurement extends Model {
  label = f.string;
  /** numeric: дробные значения обязаны приходить числом. */
  amount = f.number.decimal.notNull();
  /** int4: нужен для sum()/avg(), которые PG считает в int8 и numeric. */
  count = f.number.notNull();
}
