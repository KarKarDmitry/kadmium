# Проблемы производительности

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

---

## P1: ResultReshaper — quadratic сложность

**Важность:** 🟢 Medium

**Краткое описание:** `ResultReshaper.reshape()` выполняет O(n × m) операций, где n = количество строк, m = количество полей в SELECT. Для большого числа полей и строк — квадратичная сложность.

**Пример:**
```typescript
// 10,000 строк × 50 полей = 500,000 операций
await orm.single(BigTable).select(t => [t.f1, t.f2, ..., t.f50]).go();
```

**Риски изменений:**
- Оптимизировать через Map для column → index — безопасно, улучшит производительность
- Использовать batch-processing — безопасно, но сложнее
- Риск: минимальный, это чистая оптимизация

**Связанные файлы:**
- `packages/sql-pg/src/result-reshaper.ts`
- `packages/sql-pg/src/index.ts` (execute методы)

**Коммит:**

---

## P2: unpackIncludes — рекурсивный обход каждой строки

**Важность:** 🟢 Medium

**Краткое описание:** `unpackIncludes()` рекурсивно обходит каждую строку для каждого include. Сложность O(n × k), где k = глубина вложенности includes.

**Риски изменений:**
- Оптимизировать через предварительный проход по includes — безопасно
- Объединить с reshape — безопасно, но сложнее
- Риск: минимальный

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (unpackIncludeValue, unpackIncludes)

**Коммит:**

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
