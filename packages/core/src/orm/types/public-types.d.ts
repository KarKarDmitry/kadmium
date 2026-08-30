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
  MultiFilterProxy,
  MultiSelectProxy,
  MultiRelationProxy,
  UpdateFinalizer,
  AliasesMap,
  FinalResult,
  NullableMethods,
} from './proxy';

export type {
  ToOneRelation,
  ToManyRelation,
  RelationsOf,
  ShapeOf,
  Evaluate,
  FlatFinalResult,
  IncludeResult,
  BuildIncludedResult,
  ISingleTableQuery,
  IFirstQuery,
  AnySelectable,
  UnionToIntersection,
} from './relations';
