export { Model } from './model/index';
export type { ModelSchema, ModelRelation } from './model/types/model';
export type { StandardField } from './model/types/_base';
export type { ReferenceField } from './model/types/ref';
export { default as f } from './model/fields/index';

export type { ModelIR, FieldIR, FieldType, RelationType } from './ir/index';
export { compileModel } from './ir/index';

export { OrmManager } from './orm/orm';

export {
  AppCore,
  KadmiumApp,
  Kadmium,
  ModuleSlot,
  defineConfig,
} from './core/index';
export type { ErrorCode, KadmiumConfig } from './core/index';
