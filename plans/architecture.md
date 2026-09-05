# Архитектурные проблемы

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Verified 2026-09-04 against actual code.
> Updated 2026-09-05 — added importance fields, new findings (A3-A7). A5+A6 resolved (`f3917da`).

---

## A1: Мутабельность KadmiumSqb

**Важность:** 🟡 High

**Краткое описание:** `KadmiumSqb` — мутабельный AST-аккумулятор. Метод `clone()` существует, но не используется системно. Переиспользование одного builder'а для нескольких запросов приводит к накоплению состояния.

**Пример бага:**
```typescript
const q = orm.single(User).where(t => t.name.eq('Alice'));
const sql1 = q.toSql(); // OK
const sql2 = q.limit(10).toSql(); // sql1 тоже получил limit=10
```

**Риски изменений:**
- Сделать `KadmiumSqb` immutable (возвращать новый экземпляр из каждого метода) — нарушит все билдеры, которые мутируют sqb
- Автоматический `clone()` в начале цепочки — безопаснее, но сложнее отследить
- Компромисс: document-only (unsafe to reuse)

**Связанные файлы:**
- `packages/core/src/orm/sqb.ts`
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`
- `packages/core/src/orm/field-builders/relation.ts`

**Коммит:**

---

## A2: Relation — два ответственных в одном классе

**Важность:** 🟢 Medium

**Краткое описание:** `Relation` (240 строк) одновременно:
1. DSL-билдер для include (`.where()`, `.order()`, `.select()`, `.include()`)
2. Рантайм-структура `IncludedRelation` для SQL-генератора
3. Phantom-типы для type-level инференса

**Риски изменений:**
- Разделить на `RelationBuilder` (DSL) + `IncludedRelation` (runtime) — потребует синхронизацию между ними
- Оставить как есть — приемлемо для текущего масштаба
- Риск: разделение усложнит include-цепочку

**Связанные файлы:**
- `packages/core/src/orm/field-builders/relation.ts`
- `packages/core/src/orm/sqb.ts` (IncludedRelation)
- `packages/core/src/orm/types/proxy.d.ts` (RelationProxy)

**Коммит:**

---

## A3: single.ts — 537 строк, 18 any-кастов

**Важность:** 🔴 Critical

**Краткое описание:** `SingleQueryBuilder` — самый большой файл в core (537 строк). Содержит 18 `as any` кастов, включая критичные пути:
- `findById()` — double `as any` cast (line 257)
- `include()` — relation builder cast (line 163)
- `select()` / `first()` — return type `any` в implementation signature (lines 132, 188)
- `_buildSelectFinalizer()` — 10 методов с `as any` (lines 413-456)

**Риски изменений:**
- Извлечь proxy-создание (lines 469-536) в отдельный файл — безопасно
- Извлечь finalizer-билдеры (lines 413-467) в отдельный файл — безопасно
- Заменить `any` на конкретные типы в критичных путях — средний риск

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`

**Коммит:**

---

## A4: diff.ts — 696 строк, 5 ответственностей

**Важность:** 🔴 Critical

**Краткое описание:** `diff.ts` — самый большой файл в проекте. Содержит:
1. Type mapping (`pgType`, `normalizePgType`, `renderDefault`)
2. Diff computation (`computeDiff`)
3. Diff application (`applyDiff`)
4. SQL rendering (`renderSql`, `opToSql`)
5. Health checks (`checkHealth`, `diffToHealth`)

Нарушает SRP. Тяжело навигировать и тестировать изолированно.

**Риски изменений:**
- Разделить на `pg-type-mapper.ts`, `diff-computer.ts`, `diff-applier.ts`, `diff-renderer.ts`, `health.ts` — безопасно, но много файлов
- Оставить как есть — принимаемо для текущего масштаба

**Связанные файлы:**
- `packages/sql-pg/src/diff.ts`

**Коммит:**

---

## A5: BaseWhereBuilder — мёртвый код

**Важность:** 🟢 Medium

**Краткое описание:** `BaseWhereBuilder` (49 строк) в `base.ts` определяет generic класс для WHERE-дерева, но ни `SingleQueryBuilder`, ни `MultiQueryBuilder` его не используют. Оба имеют собственные `_or()` методы с дублирующейся логикой.

**Статус:** ✅ Удалён в `f3917da` вместе с A6.

**Связанные файлы:**
- `packages/core/src/orm/builders/base.ts` (удалён)
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`

**Коммит:** `f3917da`

---

## A6: Дублирование _or() в single.ts и multi.ts

**Важность:** 🟡 High

**Краткое описание:** Почти идентичная логика `_or()` в двух файлах:
- `single.ts:90-114` — 25 строк
- `multi.ts:73-93` — 21 строка

Оба обрабатывают: пустые условия, смену оператора, оборачивание в группу. `BaseWhereBuilder` (A5) содержит похожую логику `_add()`, но не используется.

**Статус:** ✅ Вынесено в `where-helpers.ts` с shared-функцией `addOrCondition()`. Удалены дублирующие `_or()` из обоих builders. Удалён мёртвый `BaseWhereBuilder`.

**Связанные файлы:**
- `packages/core/src/orm/builders/where-helpers.ts` (создан)
- `packages/core/src/orm/builders/single.ts` (_or удалён)
- `packages/core/src/orm/builders/multi.ts` (_or удалён)

**Коммит:** `f3917da`

---

## A7: Дублирование create() и execute() в sql-pg

**Важность:** 🟡 High

**Краткое описание:** `PgAdapter.create()` (lines 191-205) и `TransactionalPgAdapter.create()` (lines 131-145) генерируют одинаковый INSERT SQL. `execute()` аналогично дублируется.

**Риски изменений:**
- Вынести генерацию SQL в `SqlGenerator` — безопасно
- Оставить как есть — дублирование Acceptable для 2 классов

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (PgAdapter, TransactionalPgAdapter)

**Коммит:**
