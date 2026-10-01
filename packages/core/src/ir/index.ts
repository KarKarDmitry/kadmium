/**
 * IR (Intermediate Representation) — единственный контракт между слоями.
 *
 * Model → $build() → IR
 * ORM, Validation, Forms, Codegen читают только IR.
 * Никто не импортирует билдеры напрямую.
 */

export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'date'
  | 'time'
  | 'ref'
  | 'primary'
  | 'bigint'
  | 'uuid'
  | 'int'
  | 'decimal'
  | 'float'
  | 'numeric';

export type RelationType = 'one-to-many' | 'many-to-one' | 'one-to-one';

/**
 * Referential action в том виде, в котором его пишет модель: нижний регистр.
 *
 * Каноническая (верхнерегистровая) форма живёт в `FieldIR` и `DbForeignKey` —
 * это та же строка, что уходит в `ALTER TABLE`. Маппинг формы — в
 * `toReferentialAction()`, единственном файле, которому положено знать обе.
 */
export type ReferentialActionInput =
  'no action' | 'cascade' | 'set null' | 'restrict' | 'set default';

/** Runtime-значение для валидации: TS ловит опечатку раньше, guard нужен для JS. */
export const REFERENTIAL_ACTION_INPUTS: readonly ReferentialActionInput[] = [
  'no action',
  'cascade',
  'set null',
  'restrict',
  'set default',
];

export interface FieldIR {
  /** Тип поля в терминах модели */
  type: FieldType;
  /** TypeScript-тип для кодогенерации */
  tsType: string;
  /** Имя колонки в БД */
  alias: string;
  /** Разрешён ли null */
  nullable: boolean;
  /** Уникальность */
  unique: boolean;
  /** Индексировано */
  index: boolean;
  /** Является ли поле первичным ключом */
  isPrimary?: boolean;

  /** Специфичные опции поля */
  spec?: Record<string, unknown>;

  // Для ref-полей
  ref?: string;
  relation?: RelationType;
  inverse?: string;
  foreignKey?: string;
  sourceModel?: string;
  targetModel?: { name: string };
  inverseRelation?: RelationType;
}

export interface ModelIR {
  /** Имя модели (класс) */
  name: string;
  /** Имя таблицы в БД (snake_case) */
  collection: string;
  /** Поля модели */
  fields: Record<string, FieldIR>;
  /** Путь к исходному файлу модели (для кодогенерации) */
  sourceFile?: string;
}

/** Конвертировать CamelCase/PascalCase в snake_case */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}
