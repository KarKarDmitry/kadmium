/**
 * Канонические phantom-wildcard'ы ORM-слоя.
 *
 * Заменяют разбросанные `SelectableField<any, any, any>` / `FuncField<any>`
 * в сигнатурах. `unknown` допустим только для неограниченных параметров
 * (`TFieldType`, `FuncField.TResult`); у constrained-параметров
 * (`TFieldName extends string`, `TAlias extends string | undefined`,
 * `TTableAlias extends string`) wildcard — верхняя граница constraint'а,
 * иначе `unknown` не проходит проверку constraint'а.
 */
import type { SelectableField } from '../ast/selectable';
import type { FuncField } from '../ast/func-field';
import type { ArrayField } from '../ast/array-field';

/** Любое select-поле конкретной колонки (wildcard для `extends`/параметров). */
export type AnySelectableField = SelectableField<
  unknown,
  string,
  string | undefined,
  string
>;

/** Любая функция в SELECT (агрегат/оконная) без вывода результата. */
export type AnyFuncField = FuncField<unknown>;

/** Любое select-поле: колонка или функция (wildcard). */
export type AnySelectable = AnySelectableField | AnyFuncField;

/** Массив-слот: wildcard для фантомного `ArrayField`. */
export type AnyArrayField = ArrayField<unknown, string, string | undefined>;
