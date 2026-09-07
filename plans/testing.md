# Проблемы тестирования

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.
> Updated 2026-09-07 — all TG items resolved. 22 unit test files in core, 12 in sql-pg, 14 integration tests.

---

## TG1: Нет unit-тестов для ORM-слоя

**Важность:** 🟡 High

**Статус:** ✅ Добавлены unit-тесты (147 cases) в `packages/core/test/orm/`. Vitest настроен в core.

**Покрыто:**
- Proxy-система (FilterProxy, SelectProxy, OrderProxy, RelationProxy) — `query-proxies.test.ts`
- KadmiumSqb (clone, where group building) — `sqb.test.ts`
- Relation (constructor, as(), where(), select(), include(), propertyName) — `relation.test.ts`
- SingleQueryBuilder (where, and, or, group, select, first, findById, create, update, delete, count, exists, toSql, go) — `single-builder.test.ts`
- MultiQueryBuilder (where, join, select, include, groupBy, limit, offset, order, toSql) — `multi-builder.test.ts`
- BaseFilter (clause, getIdentifierForSql) — `base-filter.test.ts`
- Filters (StringFilter, NumberFilter, BooleanFilter, DateFilter, addNullable) — `filters.test.ts`
- createFilter routing + nullable — `factory.test.ts`
- Aggregates (count, sum, avg, min, max, toSql) — `aggregates.test.ts`
- addOrCondition (AND, OR, nested) — `where-helpers.test.ts`

**Связанные файлы:**
- `packages/core/test/orm/*.test.ts` (созданы)
- `packages/core/test/orm/helpers.ts` (создан — mock adapter, IR fixtures)
- `packages/core/vitest.config.ts` (создан)
- `packages/core/package.json` (добавлен vitest + test script)
- `packages/core/tsconfig.json` (добавлен test includes)

**Коммит:** `aa8b2a0`

---

## TG2: ResultReshaper не покрыт тестами

**Важность:** 🟡 High

**Краткое описание:** `ResultReshaper.reshape()` — критический компонент, но нет unit-тестов. Баги в reshape приводят к неправильным результатам.

**Статус:** ✅ Добавлены unit-тесты (11 cases) в `packages/sql-pg/test/result-reshaper.test.ts` в `36951f7`. Vitest настроен в sql-pg.

**Связанные файлы:**
- `packages/sql-pg/src/result-reshaper.ts`
- `packages/sql-pg/test/result-reshaper.test.ts` (создан)

**Коммит:** `36951f7`

---

## TG3: Proxy-система не тестируется изолированно

**Важность:** 🟡 High

**Статус:** ✅ Покрыто в `query-proxies.test.ts` — тесты для `createFilterProxy`, `createSelectProxy`, `createOrderProxy`, `createRelationProxy`. Включено в TG1.

**Связанные файлы:**
- `packages/core/test/orm/query-proxies.test.ts` (создан)

---

## TG4: pgType/diffToHealth/compile — unit-тесты удалены

**Важность:** 🟢 Medium

**Статус:** ✅ Добавлены unit-тесты для diff/types.ts (54 cases), diffToHealth (8 cases) в `packages/sql-pg/test/diff/`. compileModel — 30 cases в `packages/core/test/ir/compile.test.ts`.

**Покрыто:**
- `pgType` — все типы полей + ref resolution + db_type (18 cases)
- `normalizePgType` — все нормализации + case insensitive (11 cases)
- `isPrimaryField` — isPrimary + type=primary (3 cases)
- `renderDefault` — все типы + escape + Date (8 cases)
- `irToColumns` — sourceModel фильтрация + alias + autoIncrement (4 cases)
- `expectedIndexes` — unique/ref/index/sourceModel/alias (6 cases)
- `expectedForeignKeys` — ref/sourceModel/unknown target/alias (4 cases)
- `diffToHealth` — все варианты summary + комбинации (8 cases)
- `compileModel` — normalizeType, basic compilation, isPrimary, alias, tsType, spec, ref fields, inverse refs, sourceFile, db options (30 cases)

**Связанные файлы:**
- `packages/sql-pg/test/diff/types.test.ts` (создан)
- `packages/sql-pg/test/diff/health.test.ts` (создан)
- `packages/core/test/ir/compile.test.ts` (создан)

**Коммит:** `dec901e`

---

## TG5: Нет unit-тестов для Model DSL, field builders, codegen, DDL adapter, sql-generator

**Важность:** 🟡 High

**Статус:** ✅ Добавлены unit-тесты (226 cases) + root vitest config.

**Покрыто:**
- Model base class ($build, $relations, $refs, registry, inheritance, MODEL_MARKER) — `model.test.ts` (16 cases)
- Field builders: string, number, boolean, datetime, primary, ref, index, model (invertRelation) — `fields/*.test.ts` (65 cases)
- Codegen: generateModel (13 cases), runner/generateAll/generateToFile/checkSync (9 cases) — `codegen/*.test.ts`
- DDL adapter: inspectTables, inspectColumns, inspectIndexes, inspectForeignKeys, createTable, addColumn, alterType, alterNullable, alterDefault, addIndex, addForeignKey, drop*, raw — `ddl-adapter.test.ts` (32 cases)
- SqlGenerator split: render-value (8), where-clause (9), select (18), update (5), upsert (7), delete (4), includes (6), join-islands (4) — `sql-generator/*.test.ts` (61 cases)
- ESLint: все ошибки и warnings исправлены в test файлах

**Связанные файлы:**
- `packages/core/test/model/model.test.ts` (создан)
- `packages/core/test/model/fields/*.test.ts` (8 файлов создано)
- `packages/core/test/codegen/generate-model.test.ts` (создан)
- `packages/core/test/codegen/runner.test.ts` (создан)
- `packages/sql-pg/test/ddl-adapter.test.ts` (создан)
- `packages/sql-pg/test/sql-generator/*.test.ts` (8 файлов создано)
- `vitest.config.ts` (создан — root config)
- `package.json` (добавлен `test` script)

**Коммит:** `dec901e`
