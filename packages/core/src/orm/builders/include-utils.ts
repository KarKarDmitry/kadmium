import { KadmiumSqb } from '../sqb';
import { Relation } from '../field-builders/relation';
import { toSnakeCase, type ModelIR } from '../../ir/index';
import type { WhereExpression } from '../ast/where';
import type { OrderDirection } from '../types/proxy';

/**
 * Значение конфига одного relation. Колбэки принимают `any`-proxy:
 * их полная типизация невозможна без generic-параметра целевой модели.
 */
export type IncludeConfigValue =
  | boolean
  | {
      alias?: string;
      where?: (proxy: any) => WhereExpression | undefined;
      order?: (proxy: any) => OrderDirection[];
      limit?: number;
      select?: (proxy: any) => readonly any[];
      include?: Record<string, IncludeConfigValue>;
    };

/**
 * Построить Relation по имени связи: единый resolution target IR
 * (sourceModel > ref > имя) с fallback на snake_case collection.
 */
export function buildRelation(
  sqb: KadmiumSqb,
  modelIr: ModelIR,
  relationName: string,
  irLookup?: (name: string) => ModelIR | undefined,
  parentAlias?: string,
): Relation {
  const fieldIr = modelIr.fields[relationName];
  const targetName = fieldIr?.sourceModel ?? fieldIr?.ref ?? relationName;
  const targetIr = irLookup?.(targetName) ?? {
    name: targetName,
    collection: toSnakeCase(targetName),
    fields: {},
  };
  return new Relation(
    sqb,
    relationName,
    targetIr,
    fieldIr,
    irLookup,
    parentAlias,
  );
}

/** Применить конфиг к построенному Relation и добавить его в sqb.includes. */
export function configureRelation(
  sqb: KadmiumSqb,
  builder: Relation,
  config: IncludeConfigValue,
): void {
  if (config === true) {
    sqb.includes.push(builder);
    return;
  }
  if (typeof config === 'object' && config !== null) {
    if (config.alias) builder.as(config.alias);
    if (config.where) builder.where(config.where);
    if (config.order) builder.order(config.order);
    if (config.limit) builder.limit(config.limit);
    if (config.select) builder.select(config.select);
    sqb.includes.push(builder);
    if (config.include) builder.include(config.include);
  }
}
