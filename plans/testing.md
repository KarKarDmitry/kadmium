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

---

## TG6: Ноль тестов CLI

**Важность:** 🟡 High

**Краткое описание:** Команды `db`, `generate`, `init`, `format`, `check` не покрыты тестами. Ни одного unit/integration теста. CLI — публичный API, регрессии не отслеживаются.

**Решение:** Минимум: `init`, `generate`, `check` с замоканной ФС. `db` — с мок-адаптером.

**Связанные файлы:**
- `packages/core/src/cli/*.ts`

---

## TG7: Нет unit-тестов для diff/compute, diff/apply, diff/render

**Важность:** 🟡 High

**Краткое описание:** `diff/compute.ts` (202 строки), `diff/apply.ts` (105), `diff/render.ts` (63) — нет dedicated unit-тестов. Тестируются только косвенно.

**Решение:** Unit-тесты с мок-адаптерами.

**Связанные файлы:**
- `packages/sql-pg/src/diff/compute.ts`
- `packages/sql-pg/src/diff/apply.ts`
- `packages/sql-pg/src/diff/render.ts`

---

## TG8: ~100 any-кастов в unit-тестах

**Важность:** 🟡 High

**Краткое описание:** Касты к `any` с `eslint-disable` в `single-builder.test.ts`, `multi-builder.test.ts`, `query-proxies.test.ts`. Маскируют регрессии в proxy-типах.

**Решение:** Типизированные тестовые хелперы для proxy-объектов.

**Связанные файлы:**
- `packages/core/test/orm/single-builder.test.ts`
- `packages/core/test/orm/multi-builder.test.ts`
- `packages/core/test/orm/query-proxies.test.ts`

---

## TG9: console.log осталось в include.test.ts и multi.test.ts

**Важность:** 🟢 Medium

**Краткое описание:** 4 `console.log` в интеграционных тестах: `include.test.ts` (3), `multi.test.ts` (1).

**Связанные файлы:**
- `test-project/test/orm/include.test.ts`
- `test-project/test/orm/multi.test.ts`

---

## TG10: Межтестовая зависимость состояния в single.test.ts

**Важность:** 🟢 Medium

**Краткое описание:** Assertions `count()` зависят от `delete()` из предыдущего теста. Fragile при переупорядочивании.

**Связанные файлы:**
- `test-project/test/orm/single.test.ts`

---

## TG11: Нет тестов для null/undefined в фильтрах

**Важность:** 🟢 Medium — ✅ **Done** (`6572887`)

**Краткое описание:** Фильтры не тестируются с `null`/`undefined`.

**Решение (принято):** `eq(null)` → `IS NULL` — `f.eq(null)` рендерит `"col" IS NULL` (как value-null в `_renderValue`), а не `= $1` с NULL (SQL 3VL → всегда false). Выполнено:
1. ✅ `filters.test.ts` — `eq(null)`/`neq(null)` на string/number/boolean/date + `undefined` throw.
2. ✅ `sql-pg/test/sql-generator/where-clause.test.ts` — `WHERE "u"."name" IS NULL` / `IS NOT NULL` рендер + allowlist throw.
3. ✅ `undefined` в операнде — throw по `eq`/`neq` (не мапится в IS NULL).
4. ✅ Интеграционный тест: `test-project/test/orm/where.test.ts` — `eq(null)`/`neq(null)` на nullable `age` с cleanup через `delete()`.

**Связанные файлы:**
- `packages/core/src/orm/field-builders/filters.ts` (eq/neq: null → IS NULL / IS NOT NULL)
- `packages/core/src/orm/field-builders/base-filter.ts` (`_eq`/`_neq` helpers)
- `packages/core/test/orm/filters.test.ts`
- `packages/sql-pg/test/sql-generator/where-clause.test.ts`
