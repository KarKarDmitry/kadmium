/**
 * Публичные типы Kadmium ORM.
 *
 * Единая точка входа для всех type-level утилит.
 * Импортируется через `orm/index.ts`.
 */
export type {
  FilterProxy,
  SelectProxy,
  RelationProxy,
  OrderProxy,
  OrderField,
  OrderDirection,
  MultiFilterProxy,
  MultiSelectProxy,
  MultiRelationProxy,
  MultiOrderProxy,
  UpdateFinalizer,
  AliasesMap,
  FinalResult,
  NullableMethods,
} from './proxy';

export type { Evaluate } from './relations';

export type {
  AnySelectable,
  AllFields,
  FlatFinalResult,
  GetFieldName,
  GetFieldType,
  IncludeConfig,
  IncludeResult,
  QueryResult,
  RelationsOf,
  ShapeOf,
} from './includes';
