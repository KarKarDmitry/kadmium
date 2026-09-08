# Архитектурные проблемы

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Verified 2026-09-04 against actual code.
> Updated 2026-09-05 — added importance fields, new findings (A3-A7). A5+A6 resolved (`f3917da`). A4 resolved (`c138f7b`). A7 resolved (`9e45588`). A3 resolved (`53a69b2`).
> Updated 2026-09-05 — BREAKING: create()/createMany() return builders, not Promises. All callers must add `.go()`.
> Updated 2026-09-07 — includes refactor resolved (`1cacf6a`): record-based API, ~relInfo phantom, relations.d.ts deleted. single.ts 419 lines, ~12 any casts (down from 537/18).
> Updated 2026-09-08 — A1 resolved via B+C (`b709ad1` + this PR): snapshot terminals + public `.clone()`.

---

## Principle: All methods until go() build AST, only go() is terminal

```typescript
// ✗ BAD — old pattern (no longer works):
await orm.single(User).create(data)

// ✓ GOOD — new pattern:
await orm.single(User).create(data).go()
await orm.single(User).create(data).onConflict(t => [t.email]).go()
await orm.single(User).update(data).where(t => t.id.eq(1)).go()
```

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

**Статус:** ✅ Решено комбинацией **B (снапшоты на терминалах) + C (публичный `.clone()`)** в двух PR:
- **PR1 (`b709ad1`)** — терминалы (`go`, `toSql`, `count`, `exists`, `update`, `delete`, `create`, `createMany`, multi `select`) работают на снапшоте (`sqb.clone()` на момент вызова) и больше не мутируют builder. `KadmiumSqb.clone()` глубоко копирует selects (агрегаты — иначе `AggregateField.as()` мутирует alias). В итоге: `count()` не перезатирает select, `exists()` не прилепляет `limit(1)`, два `create()` на одном билдере не делят `upsertData`.
- **PR2 (этот)** — интеграционные тесты `test-project/test/orm/clone.test.ts` (паттерн `base.clone()`, регрессы count/exists/update) + обновлённый раздел про reuse в `core/AGENTS.md`.
- **Документированное поведение:** конфиг-вызовы (`.where`, `.limit`, `.order`) по-прежнему мутируют builder in-place; `const q = …; q.limit(10)` меняет `q` намеренно — для безопасного ветвления использовать `.clone()`:
  ```typescript
  const base = app.orm.single(User);
  await base.clone().page(1, 10).go(); // base не тронут
  ```

**Связанные файлы:**
- `packages/core/src/orm/sqb.ts`
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`
- `packages/core/src/orm/field-builders/relation.ts`

**Коммит:** `b709ad1` + PR2

---

## A2: Relation — два ответственных в одном классе

**Важность:** 🟢 Medium

**Краткое описание:** `Relation` (133 строки, было 240) одновременно:
1. DSL-билдер для include (`.where()`, `.order()`, `.select()`, `.include()`)
2. Рантайм-структура `IncludedRelation` для SQL-генератора
3. Phantom-типы для type-level инференса

**Статус:** ⬜ Открыто, но значительно упрощено в `1cacf6a` (246 → 133 строки). Record-based include API убрал нужду в `IRelationBuilder`. Разделение на `RelationBuilder` + `IncludedRelation` всё ещё может улучшить читаемость, но уже не критично.

**Связанные файлы:**
- `packages/core/src/orm/field-builders/relation.ts`
- `packages/core/src/orm/sqb.ts` (IncludedRelation)
- `packages/core/src/orm/types/proxy.d.ts` (RelationProxy)

**Коммит:** `1cacf6a`

---

## A3: single.ts — 419 строк, ~12 any-кастов

**Важность:** 🔴 Critical

**Краткое описание:** `SingleQueryBuilder` — самый большой файл в core (419 строк, было 537). Содержит ~12 `as any` кастов (было 18), включая критичные пути:
- `return this as any` (line 140) — хак для возврат `this`
- `select() / first()` — return type `any` (lines 155, 356)
- `_buildSelectFinalizer()` — остатки `any` кастов

**Статус:** ⬜ Частично решено. single.ts: 537 → 419 строк (−22%), `any` касты: 18 → ~12 (−33%). Proxy-фабрики извлечены в `query-proxies.ts` (`53a69b2`). includes refactor убрал Relation-related касты (`1cacf6a`). Осталось: finalizer-билдеры и замена оставшихся `any`.

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/query-proxies.ts` (создан)

**Коммиты:** `53a69b2`, `1cacf6a`

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

**Статус:** ✅ Разделён на `diff/` директорию в `c138f7b`:
- `diff/types.ts` — типы + маппинг
- `diff/compute.ts` — computeDiff
- `diff/apply.ts` — applyDiff
- `diff/render.ts` — renderSql
- `diff/index.ts` — barrel + health check

Публичный API не изменился (`from './diff'` → `diff/index.ts`).

**Связанные файлы:**
- `packages/sql-pg/src/diff/` (директория)

**Коммит:** `c138f7b`

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

**Статус:** ✅ Вынесены shared-хелперы `createRow()` и `rawQuery()` в `9e45588`. `execute()` оставлен в классах (7 строк, дублирование минимальное).

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (PgAdapter, TransactionalPgAdapter)

**Коммит:** `9e45588`
