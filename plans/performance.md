# Проблемы производительности

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.
> Updated 2026-09-07 — verified P1 optimal, P2 optimized.
> Updated 2026-09-08 — added P6 (batch upsert N+1), from project review.

---

## P1: ResultReshaper — quadratic сложность

**Важность:** 🟢 Medium

**Краткое описание:** `ResultReshaper.reshape()` выполняет O(n × m) операций, где n = количество строк, m = количество полей в SELECT. Для большого числа полей и строк — квадратичная сложность.

**Пример:**
```typescript
// 10,000 строк × 50 полей = 500,000 операций
await orm.single(BigTable).select(t => [t.f1, t.f2, ..., t.f50]).go();
```

**Статус:** Проверено — предвычисление fieldMap не даёт выигрыша (overhead от аллокации объектов компенсирует benefit). Текущая реализация уже оптимальна для типичных случаев.

**Связанные файлы:**
- `packages/sql-pg/src/result-reshaper.ts`

**Коммит:** —

---

## P2: unpackIncludes — рекурсивный обход каждой строки

**Важность:** 🟢 Medium

**Краткое описание:** `unpackIncludes()` рекурсивно обходит каждую строку для каждого include. Сложность O(n × k), где k = глубина вложенности includes.

**Статус:** ✅ Оптимизировано — `nested.find()` заменён на `Map.get()` (O(1) вместо O(k)). В `unpackIncludeValue` предвычисляется Map для nested includes.

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (unpackIncludeValue)

**Коммит:** (pending)

---

## P3: _buildJoinGraph + _findJoinIslands — BFS для каждого запроса

**Важность:** ⚪ Low

**Краткое описание:** Для каждого SELECT-запроса строится граф соединений и ищутся острова через BFS. Для простых запросов (1-2 таблицы) это overhead.

**Риски изменений:**
- Кешировать граф для повторяющихся запросов — безопасно
- Упростить для простых случаев (1 join) — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/sql-pg/src/sql-generator.ts` (_buildJoinGraph, _findJoinIslands)

**Коммит:**

---

## P6: Batch upsert (createMany().onConflict()) — N+1 запись

**Статус:** ✅ Готово

**Коммит:** `a5f3a4d`

**Важность:** 🟡 High

**Краткое описание:** При указанном conflict target `createMany(...).onConflict(...).go()` терминал в цикле выполняет отдельный `adapter.execute(sqb)` для **каждого** ряда.

**Место:** `packages/core/src/orm/builders/upsert-helpers.ts:120-138`

```typescript
for (const row of mappedRows) {
  const sqb = new (baseSqb.constructor as any)();
  // ... конфигурация одного ряда ...
  const result = await adapter.execute(sqb);  // 1 round-trip на ряд
}
```

Для 1000 строк — 1000 последовательных round-trips (без батчинга и без параллелизма). Противоположно plain `createMany` (без ON CONFLICT), который собирает один multi-VALUES INSERT как единый запрос. ALSO дополняется N+1 в самом `go()`.

**Суть:** Противоречит собственной дисциплине проекта (AGENTS.md / TODO `N+1` elimination — include перестроен на `LEFT JOIN LATERAL`, чтобы убрать N+1). Здесь в write-пути N+1 остаётся.

**Решение:** PostgreSQL поддерживает multi-row `INSERT ... VALUES (...), (...) ... ON CONFLICT (target) DO UPDATE SET ... RETURNING`. Текущий `_buildUpsertQuery` (`sql-generator.ts`) синтезирует только однорядковый upsert — нужен многострочный путь через adapter, генерирующий один батч-запрос. Минимум — задокументировать O(n) round-trip поведение, если батчинг отложен.

**Связанные файлы:**
- `packages/core/src/orm/builders/upsert-helpers.ts` (go())
- `packages/sql-pg/src/sql-generator.ts` (_buildUpsertQuery)
- `packages/sql-pg/src/index.ts` (buildUpsertManySql, createManyRows)
- `packages/sql-types/src/index.ts` (options createMany)

**Коммит:** `a5f3a4d`

---

## P4: compileCount — public без сброса

**Важность:** ⚪ Low

**Краткое описание:** `OrmManager.compileCount` — public поле без механизма сброса. В production невозможно отследить, сколько раз компилировался IR.

**Риски изменений:**
- Добавить `resetCompileCount()` — безопасно
- Сделать private + getter — нарушит обратную совместимость
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/orm.ts` (OrmManager)

**Коммит:**

---

## P5: computeDiff делает 3N+1 запросов для N таблиц

**Важность:** 🟡 High

**Краткое описание:** `computeDiff` (diff/compute.ts:79-82) для каждой таблицы выполняет 3 отдельных запроса (`inspectColumns`, `inspectIndexes`, `inspectForeignKeys`). Для схемы с N таблицами — 3N+1 запросов. Для 50+ таблиц это существенный round-trip overhead.

**Решение:** Один batched-запрос к `information_schema`/`pg_catalog`, возвращающий метаданные всех таблиц за один round-trip.

**Связанные файлы:**
- `packages/sql-pg/src/diff/compute.ts` (lines 79-82)

---

## P6: applyDiff не оборачивает в транзакцию

**Важность:** 🟡 High

**Краткое описание:** `applyDiff` (diff/apply.ts) применяет DDL-операции последовательно без транзакции. Сбой в середине миграции оставляет БД в частично-применённом состоянии. `renderSql` корректно оборачивает в `BEGIN/COMMIT`, но `applyDiff` — нет.

**Решение:** Обернуть `applyDiff` в BEGIN/COMMIT (PG поддерживает DDL в транзакциях с 9.1+).

**Связанные файлы:**
- `packages/sql-pg/src/diff/apply.ts`

---

## P7: MAX_BATCH_ROWS хардкод без учёта количества колонок

**Важность:** 🟢 Low

**Краткое описание:** `MAX_BATCH_ROWS = 1000` (index.ts:103) не зависит от числа колонок. При 1 колонке PG разрешает 65,535 параметров. Динамический расчёт `floor(65535 / columnsPerRow)` эффективнее.

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (line 103)
