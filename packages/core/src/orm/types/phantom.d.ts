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
import type {
  CompiledQuery,
  SlotDefinition,
} from '@karkardmitry/kadmium-sql-types';
import type { FilterProxy } from './proxy';

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

/** Любой скомпилированный запрос (слоты/результат неизвестны). */
export type AnyCompiledQuery = CompiledQuery<Record<string, unknown>, unknown>;

/** Featherweight фильтр-прокси: любой ключ → фильтр. */
export type AnyFilterProxy = FilterProxy<{
  ['~shape']: Record<string, unknown>;
}>;

/** Erased контракт QuerySlots/MultiQuerySlots для compile(): runtime-проверка имён. */
export type SlotNameGuard = {
  assertSlotNames(slotOrder: readonly SlotDefinition[]): void;
};
