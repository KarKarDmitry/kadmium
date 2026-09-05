# Проблемы тестирования

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

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

**Статус:** ✅ Добавлены unit-тесты для diff/types.ts (54 cases) и diffToHealth (8 cases) в `packages/sql-pg/test/diff/`. Тесты для compileModel не добавлены — требуют сложного мока иерархии Model.

**Покрыто:**
- `pgType` — все типы полей + ref resolution + db_type (18 cases)
- `normalizePgType` — все нормализации + case insensitive (11 cases)
- `isPrimaryField` — isPrimary + type=primary (3 cases)
- `renderDefault` — все типы + escape + Date (8 cases)
- `irToColumns` — sourceModel фильтрация + alias + autoIncrement (4 cases)
- `expectedIndexes` — unique/ref/index/sourceModel/alias (6 cases)
- `expectedForeignKeys` — ref/sourceModel/unknown target/alias (4 cases)
- `diffToHealth` — все варианты summary + комбинации (8 cases)

**Связанные файлы:**
- `packages/sql-pg/test/diff/types.test.ts` (создан)
- `packages/sql-pg/test/diff/health.test.ts` (создан)

**Коммит:** (pending)
