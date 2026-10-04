import { Model } from './index';
import type { ModelSchema } from './types/model';
import type { ReferenceField } from './types/ref';
import type { ModelIR, FieldIR, ResultTsType } from '../ir/index';
import {
  assertSinglePrimaryKey,
  toSnakeCase,
  toReferentialAction,
  toResultTsType,
} from '../ir/index';

/**
 * Компилирует модель в IR — единственный контракт для всех слоёв.
 *
 * Живёт в model-слое: это и есть стрелка Model → IR в архитектурной схеме.
 * Слои выше (ORM, Validation, Forms, Codegen) читают уже готовый IR.
 *
 * Использование:
 *   const ir = compileModel(new Notes());
 *   orm.query(ir).where(...).go()
 */
export function compileModel(model: Model, sourceFile?: string): ModelIR {
  const schema: ModelSchema = model.$build();
  const refs = model.$refs();

  const fields: Record<string, FieldIR> = {};
  const refTsTypes = new Map<string, ResultTsType>();

  for (const [name, field] of Object.entries(schema.fields)) {
    // Сохраняем db_type из поля (для uuid PK, etc.)
    const dbType = field.db?.db_type as string | undefined;
    const fieldSpec = (field as unknown as { spec?: unknown }).spec as
      Record<string, unknown> | undefined;
    const spec: Record<string, unknown> = {};
    if (dbType) spec.db_type = dbType;
    // `withTimeZone()` — флаг, а не db_type: смысл задаёт ядро, а PG-имя типа
    // выбирает адаптер.
    if (field.db?.tz) spec.tz = true;
    if (fieldSpec && fieldSpec.default !== undefined) {
      spec.default = fieldSpec.default;
    }

    const rawType = (field as unknown as Record<string, unknown>)
      .type as string;
    const resolvedType =
      rawType == null || rawType === '_' ? field._meta._type : rawType;

    const isRefField = field._meta._type === 'ref';

    const base: FieldIR = {
      type: normalizeType(resolvedType),
      // ref-поле tsType не объявляет: у него ниже он выводится из целевого PK,
      // поэтому здесь берём заведомо валидный placeholder, а не падаем.
      tsType: isRefField
        ? 'number'
        : toResultTsType(field.tsType, {
            model: schema._meta.name,
            field: name,
          }),
      alias: field.alias ?? name,
      nullable: field.db.nullable,
      unique: field.db.unique,
      index: field.db.index,
      isPrimary: field._meta._type === 'primary',
      spec: Object.keys(spec).length > 0 ? spec : undefined,
    };

    // Если ref-поле — добавляем метаданные связи
    if (isRefField) {
      const ref = field as ReferenceField;
      base.ref = ref.ref;
      base.relation = ref.relation;
      base.inverse = ref.inverse;
      base.foreignKey = ref.foreignKey;
      // FK-колонка хранит значение PK цели, поэтому её tsType — tsType
      // целевого PK (у uuid-PK это 'string', а не 'number' — B8).
      base.tsType = resolveRefTsType(ref.ref, refTsTypes);
      // Действие копируется только здесь: поля-владельцы колонки ниже, у
      // обратных связей (sourceModel) FK нет — см. цикл обратных связей ниже.
      if (ref.onDelete) base.onDelete = toReferentialAction(ref.onDelete);
      if (ref.onUpdate) base.onUpdate = toReferentialAction(ref.onUpdate);
    }

    fields[name] = base;
  }

  // Добавляем обратные связи как виртуальные поля
  for (const rel of refs) {
    // Пропускаем, если поле уже объявлено явно
    if (fields[rel.inverse!]) continue;

    fields[rel.inverse!] = {
      type: 'ref',
      tsType: resolveRefTsType(rel.sourceModel ?? rel.field, refTsTypes),
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

  // Наследование: добавляем inverse refs от родителя.
  // $refs() модели возвращает связи только на МОЁ имя класса; рефы,
  // нацеленные на родителя, ребёнок не видит. Поэтому поднимаемся по
  // цепочке прототипов на один уровень и докидываем refs родителя.
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
              tsType: resolveRefTsType(
                rel.sourceModel ?? rel.field,
                refTsTypes,
              ),
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

  const ir: ModelIR = {
    name: schema._meta.name,
    collection: toSnakeCase(schema._meta.name),
    fields,
    sourceFile,
  };

  // Ловим на компиляции модели, а не в `syncSchema`: правило живёт в
  // `ir/index.ts` и одно на оба уровня (см. `assertSinglePrimaryKey`).
  // Обратные связи выше проверены быть не могут — у них `sourceModel`
  // и `isPrimary` не бывает.
  assertSinglePrimaryKey(ir);
  return ir;
}

/**
 * tsType значения, которое отдаёт FK-колонка (и обратная связь).
 *
 * Это tsType целевого PK: у `author = f.ref.target(User)` колонка хранит
 * ровно то, что лежит в `User`'s PK. Раньше сюда писалось имя модели, и это
 * портило две вещи: кодген решал по нему, нужен ли `import { User }`, а в
 * `~shape` подставлял `'number'` у любого PK — включая uuid (B8).
 *
 * `$build()` целевой модели здесь безопасен: ref-поле сохраняет имя и
 * ничего не резолвит (`fields/ref.ts`), поэтому рекурсии в `compileModel`
 * не возникает.
 *
 * Нерегистрированная цель — `console.warn`, а не throw: так же поступает
 * `$relations()` (`model/index.ts`), и `Model.clear()` в тестах не должен
 * превращать компиляцию в исключение.
 */
function resolveRefTsType(
  targetName: string,
  cache: Map<string, ResultTsType>,
): ResultTsType {
  const cached = cache.get(targetName);
  if (cached) return cached;

  const Target = Model.resolve(targetName);
  let resolved: ResultTsType = 'number';
  if (Target) {
    const pk = Object.values(new Target().$build().fields).find(
      (f) => f._meta._type === 'primary',
    );
    if (pk?.tsType === 'number' || pk?.tsType === 'string') {
      resolved = pk.tsType;
    }
  } else {
    console.warn(
      `[compileModel] target model "${targetName}" is not registered; ` +
        `assuming tsType 'number' for its foreign key. Call Model.register().`,
    );
  }

  cache.set(targetName, resolved);
  return resolved;
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
    // `time` обязан остаться `time`: схлопывание в `datetime` делало ветку
    // `pgType('time')` и `normalizePgType('time without time zone')` мёртвым
    // кодом — колонка `time` никогда не создавалась, вместо неё была
    // `timestamp`, а `db:push` молчал, считая схему актуальной.
    time: 'time',
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
