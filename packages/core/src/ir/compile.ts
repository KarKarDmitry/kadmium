import { Model } from '../model/index';
import type { ModelSchema } from '../model/types/model';
import type { ReferenceField } from '../model/types/ref';
import type { ModelIR, FieldIR } from './index';
import { toSnakeCase } from './index';

/**
 * Компилирует модель в IR — единственный контракт для всех слоёв.
 *
 * Использование:
 *   const ir = compileModel(new Notes());
 *   orm.query(ir).where(...).go()
 */
export function compileModel(model: Model, sourceFile?: string): ModelIR {
  const schema: ModelSchema = model.$build();
  const refs = model.$refs();

  const fields: Record<string, FieldIR> = {};

  for (const [name, field] of Object.entries(schema.fields)) {
    // Сохраняем db_type из поля (для uuid PK, etc.)
    const dbType = field.db?.db_type as string | undefined;
    const spec: Record<string, unknown> = {};
    if (dbType) spec.db_type = dbType;

    const rawType = (field as unknown as Record<string, unknown>)
      .type as string;
    const resolvedType = rawType === '_' ? field._meta._type : rawType;

    const base: FieldIR = {
      type: normalizeType(resolvedType),
      tsType: field.tsType ?? 'unknown',
      alias: field.alias ?? name,
      nullable: field.db.nullable,
      unique: field.db.unique,
      index: field.db.index,
      spec: Object.keys(spec).length > 0 ? spec : undefined,
    };

    // Если ref-поле — добавляем метаданные связи
    if (field._meta._type === 'ref') {
      const ref = field as ReferenceField;
      base.ref = ref.ref;
      base.relation = ref.relation;
      base.inverse = ref.inverse;
      base.foreignKey = ref.foreignKey;
    }

    fields[name] = base;
  }

  // Добавляем обратные связи как виртуальные поля
  for (const rel of refs) {
    // Пропускаем, если поле уже объявлено явно
    if (fields[rel.inverse!]) continue;

    fields[rel.inverse!] = {
      type: 'ref',
      tsType: rel.sourceModel ?? rel.field,
      alias: rel.inverse!,
      nullable: rel.relation === 'one-to-one',
      unique: false,
      index: false,
      ref: rel.sourceModel ?? rel.field,
      relation: rel.inverseRelation,
      sourceModel: rel.sourceModel,
      inverse: rel.inverse,
      inverseRelation: rel.relation,
      foreignKey: rel.foreignKey,
    };
  }

  // Наследование: добавляем inverse refs от родителя
  const ParentCtor = Object.getPrototypeOf(model.constructor) as
    typeof Model | undefined;
  if (ParentCtor && ParentCtor !== Model && typeof ParentCtor === 'function') {
    try {
      const parentInstance = new (ParentCtor as new () => Model)();
      const parentRefs = parentInstance.$refs();
      for (const rel of parentRefs) {
        if (!refs.find((r) => r.field === rel.field)) {
          refs.push(rel);
          // Добавляем поле, если его ещё нет
          if (rel.inverse && !fields[rel.inverse]) {
            fields[rel.inverse!] = {
              type: 'ref',
              tsType: rel.sourceModel ?? rel.field,
              alias: rel.inverse!,
              nullable: rel.relation === 'one-to-one',
              unique: false,
              index: false,
              ref: rel.sourceModel ?? rel.field,
              relation: rel.inverseRelation,
              sourceModel: rel.sourceModel,
              inverse: rel.inverse,
              inverseRelation: rel.relation,
              foreignKey: rel.foreignKey,
            };
          }
        }
      }
    } catch {
      // Родитель не инстанцируется — пропускаем
    }
  }

  return {
    name: schema._meta.name,
    collection: toSnakeCase(schema._meta.name),
    fields,
    sourceFile,
  };
}

/**
 * Приводит _type из метаданных к FieldType.
 * Отлавливаем все известные типы, остальные — 'string'.
 */
function normalizeType(raw: string): FieldIR['type'] {
  const map: Record<string, FieldIR['type']> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    time: 'datetime',
    datetime: 'datetime',
    date: 'date',
    ref: 'ref',
    primary: 'primary',
    bigint: 'bigint',
    uuid: 'uuid',
    int: 'int',
    decimal: 'decimal',
    float: 'float',
    numeric: 'numeric',
  };
  return map[raw] ?? 'string';
}
