/**
 * IR (Intermediate Representation) - промежуточное представление модели.
 *
 * Model → $build() → IR
 * ORM, Validation, Forms, Codegen читают только IR.
 * Это единственный контракт между слоями.
 */

import type { ReferentialAction } from '@karkardmitry/kadmium-sql-types';

export type { ReferentialAction };

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

const REFERENTIAL_ACTION_BY_INPUT: Record<
  ReferentialActionInput,
  ReferentialAction
> = {
  'no action': 'NO ACTION',
  cascade: 'CASCADE',
  'set null': 'SET NULL',
  restrict: 'RESTRICT',
  'set default': 'SET DEFAULT',
};

/**
 * Единственное место, где известны обе формы: модель пишет `ReferentialActionInput`,
 * IR и `DbForeignKey` носят `ReferentialAction`.
 *
 * Явная таблица, а не `toUpperCase()`: у `'set null'` есть единственная
 * правильная форма, и `'SET NULL'.toUpperCase()` — не то же самое, что
 * `'SET  NULL'`, `'set\tnull'` или `'setNull'`. Список из пяти строк виден целиком.
 */
export function toReferentialAction(
  action: ReferentialActionInput,
): ReferentialAction {
  return REFERENTIAL_ACTION_BY_INPUT[action];
}

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
  /**
   * ON DELETE / ON UPDATE FK-колонки этого поля. Каноническая (верхняя) форма.
   *
   * Есть только у полей-владельцев колонки: обратные связи (`sourceModel`) не
   * создают FK, поэтому и действие им не нужно.
   */
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
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
