# Проблемы тестирования

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

---

## TG1: Нет unit-тестов для ORM-слоя

**Важность:** 🟡 High

**Краткое описание:** Все тесты — интеграционные в `test-project/test/`. Нет unit-тестов для:
- Proxy-системы (FilterProxy, SelectProxy, RelationProxy)
- KadmiumSqb (clone, where group building)
- Relation (as(), where(), select(), include())
- SingleQueryBuilder / MultiQueryBuilder

**Риски изменений:**
- Добавить unit-тесты — безопасно, улучшит покрытие
- Использовать mocks для adapter — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`
- `packages/core/src/orm/field-builders/relation.ts`
- `packages/core/src/orm/field-builders/filters.ts`
- `packages/core/src/orm/sqb.ts`

**Коммит:**

---

## TG2: ResultReshaper не покрыт тестами

**Важность:** 🟡 High

**Краткое описание:** `ResultReshaper.reshape()` — критический компонент, но нет unit-тестов. Баги в reshape приводят к неправильным результатам.

**Риски изменений:**
- Добавить unit-тесты с mock-данными — безопасно
- Покрыть edge cases (пустые строки, null values, nested includes) — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/sql-pg/src/result-reshaper.ts`

**Коммит:**

---

## TG3: Proxy-система не тестируется изолированно

**Важность:** 🟡 High

**Краткое описание:** Proxy-объекты (FilterProxy, SelectProxy, RelationProxy) создаются через `new Proxy()`, но их поведение не проверяется изолированно.

**Риски изменений:**
- Добавить unit-тесты для proxy — безопасно
- Проверить типы через type-level tests — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts` (_createFilterProxy, _createSelectProxy)
- `packages/core/src/orm/builders/multi.ts` (_createFilterProxy, _createSelectProxy)

**Коммит:**

---

## TG4: pgType/diffToHealth/compile — unit-тесты удалены

**Важность:** 🟢 Medium

**Краткое описание:** В AGENTS.md указано: "`pgType`/`diffToHealth`/`compile` unit tests were **removed**; pure functions now covered only indirectly." Чистые функции теперь покрыты только косвенно.

**Риски изменений:**
- Вернуть unit-тесты для чистых функций — безопасно
- Оставить как есть — минимум риска, но худшее покрытие
- Риск: минимальный

**Связанные файлы:**
- `packages/sql-pg/src/diff.ts` (pgType, diffToHealth)
- `packages/core/src/ir/compile.ts` (compileModel)

**Коммит:**
