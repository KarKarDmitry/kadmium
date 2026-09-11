# Архитектурные проблемы

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Verified 2026-09-04 against actual code.
> Updated 2026-09-05 — added importance fields, new findings (A3-A7). A5+A6 resolved (`f3917da`). A4 resolved (`c138f7b`). A7 resolved (`9e45588`). A3 resolved (`53a69b2`).
> Updated 2026-09-05 — BREAKING: create()/createMany() return builders, not Promises. All callers must add `.go()`.
> Updated 2026-09-07 — includes refactor resolved (`1cacf6a`): record-based API, ~relInfo phantom, relations.d.ts deleted. single.ts 419 lines, ~12 any casts (down from 537/18).
> Updated 2026-09-08 — A1 resolved via B+C (`b709ad1` + this PR): snapshot terminals + public `.clone()`.
> Updated 2026-09-08 — A3 resolved (`c78c0e7` + `2ec3067` + `72e66fc`): any-casts 12→4 inherent, update/delete → write-finalizer.ts, includes dedup → include-utils.ts.
> Updated 2026-09-08 — added A12 (global state/singleton), from project review.
> Updated 2026-09-11 — A15/A16 done (`6fb6711`): shared `buildDebugSql` + `mapRow` in `builders/utils.ts`. A18 done (`5f21a41`): DDL SQL in a single source of truth (`ddl-sql.ts`), preview and adapter delegate to it.

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

**Статус:** ✅ Полностью решено в три коммита:
- **`c78c0e7` (A3-1)** — убраны/сужены `any`-касты в `SingleQueryBuilder`: оставшиеся 5 сведены к 4 **inherent** позициям (сигнатуры реализации перегрузок, фантомный PK в findById, результат `go()` через `Evaluate<>`, колбэк `_resolveIncludes`). Остались касты `select`/`returning` через `AnySelectableField`.
- **`2ec3067` (A3-2)** — из `update()`/`delete()` (~150 ×2 строк) извлечён `buildWriteFinalizer()` в `write-finalizer.ts`; маппинг рядов вынесен в `_mapAliases`. single.ts: 548 → ~440 строк.
- **`72e66fc` (A3-3)** — трижды продублированный include-resolution (single/multi/relation) консолидирован в `buildRelation()` + `configureRelation()` из `include-utils.ts`; relation.ts snake_case-fallback → `toSnakeCase()`. Удалён write-only `multi._includeConfigs`. single.ts: ~440 → ~405 строк.

Итог: 5 → 4 inherent `any` (перегрузки `select`/`first`, findById, go-результат), дубликатов include-логики нет. Лint warnings: 97 → 89. Core 284/284, sql-pg 194/194, проект 98/98.

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/write-finalizer.ts` (создан)
- `packages/core/src/orm/builders/include-utils.ts` (создан)
- `packages/core/src/orm/builders/multi.ts`
- `packages/core/src/orm/field-builders/relation.ts`

**Коммиты:** `53a69b2`, `1cacf6a`, `c78c0e7`, `2ec3067`, `72e66fc`

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

## A12: Процесс-глобальный стейт (registry, singleton) — latent hazard ✅

**Статус:** ✅ Resolved. Пункты 1-2 закрыты; пункт 3 (`ModelImporter.sourceFiles`) — per-instance, перезапись детерминирована, оставлено как есть; пункт 4 (`standaloneCache`) удалён вместе со standalone `orm` в D5.

**Важность:** 🟢 Medium (design debt — нет активных сбоев, но риск для reload/multi-app)

**Краткое описание:** Несколько модульно-глобальных состояний копятся на весь процесс и не имеют публичного сброса:

1. **`Model.registry`** — `private static Map` (`packages/core/src/model/index.ts:15`). Пишется в `register()` (`:23-27`), ключ — только имя класса, без дедупликации (тихо перезаписывает). Читается в `resolve()`/`models`/`$refs()`. **Никогда не очищается.** Каждый `new KadmiumApp()`/`new AppCore()` дописывает в него свои классы; `ModelRegistry.register()` (`model-registry.ts:19-28`) тоже зовёт `Model.register`. Классы живут весь процесс даже после GC своего AppCore.
2. **`Kadmium` singleton** — `export const Kadmium = new KadmiumApp()` (`kadmium-app.ts:54`). Экспортируется публично (`core/index.ts`, `src/index.ts:15`), но **нигде в кодовой базе не используется** (только в doc-комментариях). Возможно, стоит удалить или честно оформить как единственный синглтон.
3. **`ModelImporter.sourceFiles`** — аккумулирует без сброса (`model-importer.ts:20,38-42`), хранится в `ModelRegistry` (`model-registry.ts:14`). Per-instance, но out-param + повторное использование реестра копит entry.
4. **`standaloneCache`** — модульный `Map<string, ModelIR>` (`orm.ts:150`), растёт без границ (то же, что D5).

**Ключевое уточнение (перепроверено):** сегодня это **не** активный баг:
- Тесты используют `fileParallelism: false` и один фиксированный набор моделей (`User`/`Post`/`Comment` из `helpers.ts:9`), ре-регистрация тех же классов перезаписывает детерминированно.
- CLI создаёт свежие инстансы на каждый вызов.
- Singleton `Kadmium` никто не потребляет.

Риск материализуется в: **двух model-графах в одном процессе** (bundled microservices, HMR, serverless reload), **тестах с разными наборами моделей** (приходится `(Model as any).registry.clear()` — смотри `model.test.ts:15-18`, `compile.test.ts:21-24` — хак через приватное поле), **задержке классов** потом процесса.

**Решение (два маленьких фикса):**
1. Публичный `Model.clear()`/`reset()` (или instance-injectable registry) — убирает `(Model as any)` хак из тестов.
2. Удалить мёртвый singleton `Kadmium` (или оформить как документированный единственный синглтон).

**Связанные файлы:**
- `packages/core/src/model/index.ts` (registry:15, register:23-27)
- `packages/core/src/core/kadmium-app.ts` (Kadmium:54)
- `packages/core/src/core/model-registry.ts` (register:19-28)
- `packages/core/src/core/model-importer.ts` (sourceFiles:20,38-42)
- `packages/core/src/orm/orm.ts` (standaloneCache:150)
- `packages/core/test/model/model.test.ts:15-18`, `packages/core/test/ir/compile.test.ts:21-24` (тестовые хаки)

**Коммит:** `3d4f5fd`

---

## A7: Дублирование create() и execute() в sql-pg

**Важность:** 🟡 High

**Краткое описание:** `PgAdapter.create()` (lines 191-205) и `TransactionalPgAdapter.create()` (lines 131-145) генерируют одинаковый INSERT SQL. `execute()` аналогично дублируется.

**Статус:** ✅ Вынесены shared-хелперы `createRow()` и `rawQuery()` в `9e45588`. `execute()` оставлен в классах (7 строк, дублирование минимальное).

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (PgAdapter, TransactionalPgAdapter)

**Коммит:** `9e45588`

---

## A13: sql-generator.ts — 692 строки, _buildSelectQueryText 180 строк

**Важность:** 🔴 Critical

**Краткое описание:** `sql-generator.ts` — самый большой файл в проекте (692 строки). Метод `_buildSelectQueryText` один занимает ~180 строк и обрабатывает SELECT, FROM, JOINs, LATERAL, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET в одном монолитном методе. Тяжело навигировать, тестировать и расширять.

**Решение:** Разложить на хелперы по клозам: `_buildFromClause()`, `_buildJoinClause()`, `_buildWhereClause()`, `_buildGroupByClause()`, `_buildHavingClause()`, `_buildOrderByClause()`, `_buildLimitClause()`. Каждый клоз — отдельная тестируемая функция.

**Связанные файлы:**
- `packages/sql-pg/src/sql-generator.ts`

---

## A14: PgAdapter / TransactionalPgAdapter дублируют execute/create/raw — ✅ Done (`e0fa072`)

**Важность:** 🟡 High

**Статус:** ✅ Done (`e0fa072` + `29126c1` style). Наиболее рискованная часть (reshape результатов `execute` — 7 строк × 2) вынесена в общий путь: почти вся работа уже шла через shared-хелперы (`createRow`, `rawQuery`, `createManyRows`). Добавлен только `finalizeRows(rows, sqb)`: `unpackIncludes` + условный `ResultReshaper.reshape` — оба класса делегируют в него. `create`/`raw`/`createMany` не трогались: однострочники уже на shared-хелперах, а multi-chunk транзакция в `PgAdapter.createMany` — легитимное отличие от `TransactionalPgAdapter`. 15 insertions / 14 deletions.

**Краткое описание:** `PgAdapter.execute()` (lines 324-335) и `TransactionalPgAdapter.execute()` (lines 247-258) идентичны кроме `this.pool.query()` vs `this.client.query()`. То же для `create()` и `raw()`. Итого ~60 строк чистого дублирования.

**Решение:** Вынести shared-хелпер `executeWithQueryFn(queryFn, sqb, logger)`, `createWithQueryFn(queryFn, collectionName, data)` и `rawWithQueryFn(queryFn, sql, params)`. Оба адаптера делегируют в хелпер с передачей `this.pool.query` / `this.client.query`.

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (PgAdapter:324-393, TransactionalPgAdapter:247-292)

---

## A15: _buildSql / _toSqlFrom продублирован в 4 файлах — ✅ Done (`6fb6711`)

**Важность:** 🟡 High

**Статус:** ✅ Done (`6fb6711`). Shared `buildDebugSql(sqb, adapter)` в `packages/core/src/orm/builders/utils.ts`. Все копии удалены; `_toSqlFrom` в single/multi — thin wrapper с null-guard. Покрыт `test/orm/utils.test.ts`.

**Краткое описание:** Идентичная функция форматирования SQL (`adapter.toSql(sqb)` → `` `SQL: ${text}\nVALUES: [...]` ``) продублирована в:
- `write-finalizer.ts:10-13`
- `upsert-helpers.ts:57-60`
- `single.ts:448-455`
- `multi.ts:195-202`

**Решение:** Одна shared-утилита `buildDebugSql(sqb, adapter): string` в общем месте (например, `builders/utils.ts`).

**Связанные файлы:**
- `packages/core/src/orm/builders/write-finalizer.ts`
- `packages/core/src/orm/builders/upsert-helpers.ts`
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`

---

## A16: _mapRow продублирован в single.ts и upsert-helpers.ts — ✅ Done (`6fb6711`)

**Важность:** 🟡 High

**Статус:** ✅ Done (`6fb6711`). Shared `mapRow(ir, row)` в `builders/utils.ts`. single.ts и upsert-helpers.ts делегируют; `_mapRow` удалён. Покрыт `test/orm/utils.test.ts`.

**Краткое описание:** Идентичная логика маппинга строк (`iterate ir.fields → alias ?? prop → filter undefined`) в:
- `single.ts:419-426` (`_mapRow`)
- `upsert-helpers.ts:36-46` (`mapRow`)

**Решение:** Одна shared-утилита `mapRow(ir, row)`.

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/upsert-helpers.ts`

---

## A17: Default-select materialization продублирована 3 раза в single.ts — ✅ Done (`fdc2f35`)

**Важность:** 🟡 High

**Статус:** ✅ Done (`fdc2f35`). Извлечён приватный `_buildAllSelects()` — единственное место, где строится "все поля из IR" (`SelectableField[]`). Все три ветки делегируют в него: bare `select()`, bare `first()` и `_materializeSelects` (+ `go()`/`exists()` через него). Guard `if (sqb.selects) return` оставлен только в `_materializeSelects` — bare `select()`/`first()` сохранили прежнюю семантику перезаписи. 10 insertions / 30 deletions, поведение не изменено (покрыто ORM-тестами).

**Краткое описание:** Логика "взять все поля из IR, исключить sourceModel, создать SelectableField" повторяется в:
- `single.ts:124-136` (ветка `select()` без аргумента)
- `single.ts:170-182` (ветка `first()` без аргумента)
- `single.ts:437-446` (`_materializeSelects`)

Хелпер `_materializeSelects` существует, но вызывается только из `go()` и `exists()`, а не из `select()`/`first()`.

**Решение:** Все три ветки должны вызывать `_materializeSelects`.

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`

---

## A18: diff/render.ts дублирует DDL SQL из ddl-adapter.ts — ✅ Done (`5f21a41`)

**Важность:** 🟡 High

**Статус:** ✅ Done (`5f21a41`). Новый `packages/sql-pg/src/ddl-sql.ts` — единственный источник DDL SQL (12 чистых билдеров). `diff/render.ts` и `PgDdlAdapter` оба делегируют в него, поэтому превью и applied SQL физически не могут разойтись. Бонус-фиксы: drop-table превью теперь с `IF EXISTS`, не-unique `CREATE INDEX` без двойного пробела; тесты (`render.test.ts` 7, `ddl-adapter.test.ts` unaffected кроме whitespace).

**Краткое описание:** `diff/render.ts` и `ddl-adapter.ts` независимо строят идентичный DDL SQL (`create-table`, `add-column`, `alter-type`). Любое изменение формата DDL требует правок в обоих файлах.

**Решение:** `diff/render.ts` делегирует в `ddl-adapter.ts` или вынести shared DDL-генератор.

**Связанные файлы:**
- `packages/sql-pg/src/diff/render.ts`
- `packages/sql-pg/src/ddl-adapter.ts`

---

## A19: _pushWhere структурно идентичен в single.ts и multi.ts — ⚪ Won't fix

**Важность:** 🟢 Medium

**Статус:** ⚪ Won't fix. Пробовали — revert `e068b64` (из `50f6793`). Дедупликация не оправдана: приватные методы по 8 строк, отличающиеся только типом прокси, самодостаточны и не несут риска дивергенции. Общий хелпер с `TProxy` заменил два явных метода на `pushWhere(join, fn, sqb, () => this._createFilterProxy())` — добавил анонимные стрелочные функции на горячем пути, которые подавляют JIT-компиляцию. Выигрыш ~4 строк не стоит потери явности и перформанса.

**Краткое описание:** `SingleQueryBuilder._pushWhere` (lines 100-108) и `MultiQueryBuilder._pushWhere` (lines 98-106) структурно идентичны. Отличается только тип прокси (`FilterProxy<TModel>` vs `MultiFilterProxy<T>`).

**Решение:** Обобщённая функция `_pushWhere(sqb, createProxy, fn)`.

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`

---

## A20: Dual IR caches в orm.ts

**Важность:** 🟢 Medium

**Краткое описание:** `OrmManager._irCache` (line 48) и кэш-замыкание в `buildIrLookup` (line 13) — два независимых IR-кэша. Оба заполняются из `appCore.ir()`, но через разные пути. Запутывающие имена, риск несвежих данных при динамической регистрации моделей.

**Связанные файлы:**
- `packages/core/src/orm/orm.ts` (lines 13, 48)

---

## A21: orm.ts импортирует Model из model-слоя

**Важность:** 🟢 Medium

**Краткое описание:** `orm.ts:4` импортирует `Model` из `../model/index`. AGENTS.md: «IR — контракт, не импортируй билдеры моделей из ORM.» `Model` — базовый класс, не билдер полей, серая зона — но создаёт зависимость ORM→Model. Используется в `buildIrLookup` и `_irFor` как fallback для компиляции IR из незарегистрированных моделей.

**Связанные файлы:**
- `packages/core/src/orm/orm.ts` (line 4)
