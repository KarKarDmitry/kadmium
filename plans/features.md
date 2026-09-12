# Отсутствующие фичи

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — F1 resolved, F6 updated.
> Updated 2026-09-07 — verified F1, F6 still resolved. F7 updated. F8 added.
> Updated 2026-09-08 — F7 resolved via A1 (`b709ad1`).
> Updated 2026-09-12 — F8 plan re-locked: variant B `{ agg, wf }`, base `FuncField`, Option A (adapter owns rendering). C1–C3 done.

---

## F8: Нет оконных функций (window functions)

**Важность:** 🟢 Medium

**Краткое описание:** Нет поддержки `OVER ()` — партиционирование, порядок, нумерация строк (`ROW_NUMBER`, `RANK`, `LAG`, `NTILE`...) и агрегатов по окну (`SUM(col) OVER (...)`).

**Статус:** ⬜ Открыто. Агрегаты реализованы, но без `over()`. План зафиксирован, C1–C5 готово (AST + рендер + unit-тесты), осталась интеграция с реальным PG и доки (C6).

**Выбранный API (вариант B — деструктуризация `{ agg, wf }`):**
```typescript
select((u, { agg, wf }) => [
  u.id,
  agg.count('*').as('total'), // COUNT(*)
  agg.sum(u.amount).over().orderBy(u.createdAt).as('runningTotal'), // SUM(amount) OVER (ORDER BY ...)
  wf.rowNumber().as('rn'), // ROW_NUMBER() OVER ()
  wf.rowNumber().partitionBy(u.deptId).orderBy(u.createdAt.desc).as('rn'),
  wf.rank().orderBy(u.amount.desc).as('rank'),
  wf.lag(u.price, 1).as('prevPrice'),
  wf.ntile(4).as('quartile'),
])
// оконные функции и агрегаты дают ОДНО скалярное значение на строку результата
// `.over()` — только у агрегатов (превращение в оконный); у wf.* окно подразумевается.
// partitionBy/orderBy/rowsBetween чейнятся прямо на поле, им опционально предшествует `.over()`.
```

**Обоснование варианта B:** lib 0.1.0 (pre-1.0), миграция = 6 строк теста (`test-project/test/orm/having.test.ts`). Единый объект тулзов оставляет место для будущих расширений (операторы, json...), без затычек вроде `(t, _aggs, wf)`. Оконные в `returning()` **не добавляются** — Postgres запрещает оконные функции в `RETURNING` (`returning` получает только `{ agg }`).

**Диапазон функций:**
- Ранжирование: `row_number()`, `rank()`, `dense_rank()`, `percent_rank()`, `cume_dist()`
- Бакеты: `ntile(n)` (`$N` — параметр)
- Смещение: `lag(col [, offset [, default]])`, `lead(col [, offset [, default]])` — offset/default — параметры
- Значение: `first_value(col)`, `last_value(col)`, `nth_value(col, n)` (`n` — параметр)
- Агрегат с окном: `agg.sum(col).over()` (→ `WindowField`), далее `.partitionBy/.orderBy`; + avg/min/max
- Типы результата: ранги → `number`; доступ к строкам → `T | null`; оконные агрегаты → как сейчас (`number | null` и т.п.)
- Фрейм v1: только `ROWS` (`rowsBetween(start, end)`, `FrameBound = number | 'unbounded' | 'current'`); `RANGE`/`GROUPS` — вне скоупа
- Окно вешается цепочкой прямо на поле: `wf.rank().orderBy(u.amount.desc)` → `OVER (ORDER BY ...)`; `.over()` на wf.* опционален (маркер), у `agg.*` обязателен (конверсия)

**Архитектура (Option A — рендером занимается адаптер):**
- Core AST — **только данные**, по аналогии `WhereCondition { op, value }`: базовый `FuncField` (kind, func, field, argValues?, over?, alias); `AggregateField`/`WindowField` наследуют
- `sql-pg` — единственный рендерер: `FUNC(inner[, $N…]) OVER (PARTITION BY … ORDER BY … ROWS BETWEEN …) AS "alias"`, `argValues` → `values.push` (параметризация)
- `toSql()` **убирается из sql-types-контракта** (`SelectableField`/`AggregateSelectable`) — прецедент: адаптер уже рендерит поля из структуры, `SelectableField.toSql()` мёртв
- Разный диалект СУБД (квотинг, `$N`/`?`/`@p1`, `NULLS`, фреймы `GROUPS`) живёт в адаптере; окно сам по себе — SQL:2003, портируем
- **Не** используем `sql\`\`Fragment (F2) — deferred; фрагментный примитив (если появится) — в sql-types, не core
- `GetFieldType<FuncField<infer T>> → T` — как с `avg`; `GetFieldName` → alias; HAVING-прокси остаётся на `AggregateField`

**Изменения (коммиты):**
- C1: рендер агрегатов → адаптер (227/492/710/785), `toSql` из контракта, зелёный бейзлайн
- C2: базовый `FuncField` + entry-point `(t, { agg, wf })` (select/first/multi.select; returning — `{ agg }`), миграция having.test.ts, обобщение `GetFieldType`/`GetFieldName`/`AnySelectable`/`FinalResult`. **Важный фикс:** `GetFieldType` переписан на phantom indexed access `S['~result']` вместо `FuncField<infer T>` — на intersection `AggregateField<number> & {alias:'cnt'}`TS объединяет кандидатов infer'а в `number | unknown = unknown`, indexed access надёжен.
- C3: AST окон — `func-field.field` допускает `null` (функции без поля), `WindowFunctions` (`wf`), `WindowSpec` — чистые данные (partitionBy/orderBy/frame), фрейм-гвард (ненулевые целые), `AggregateField.over()` → `WindowField` (`aggregate=true`), `SelectTools = { agg, wf }`, `ReturningTools = { agg }` (без wf — PG запрещает окна в RETURNING). `validate()` вызывается адаптером при рендере. API: `wf.rank().orderBy(...)`, `agg.sum(x).over().partitionBy(...)`
- C4: рендер окон в sql-pg — `WindowSelectable` в sql-types-контракте, `AnySelectableField` включает `WindowField`, `_renderWindow` (тело + `$N` парам-аргументы через `values.push`) + `_renderOverClause`/`_renderFrameBound`, validation при рендере. **Важная коррекция:** ORDER BY требуют ТОЛЬКО 4 ранга (`rank/dense_rank/percent_rank/cume_dist`) — `row_number() OVER ()` валиден, `ntile/lag/lead/first/last/nth` тоже. HAVING-гвард не нужен: kind='window' не попадает в aggAliases автоматически.
- C5: unit-тесты sql-pg рендера (OVER, `$N`, фреймы, throw) + core-коррекция validate()
- C5: unit-тесты core + sql-pg (рендер с `$N`, фреймы)
- C6: интеграция (docker PG) + доки (typing.md, AGENTS, README)

**Связанные файлы:**
- `packages/core/src/orm/field-builders/aggregates.ts`
- `packages/core/src/orm/ast/aggregate.ts` → базовый `FuncField` (новый `ast/func-field.ts`), `ast/window-field.ts`, `ast/window-spec.ts`
- `packages/core/src/orm/types/proxy.d.ts` (сигнатура select/first/GetFieldType/GetFieldName)
- `packages/core/src/orm/builders/single.ts`/`multi.ts`/`write-finalizer.ts` (сигнатуры)
- `packages/sql-types/src/index.ts` (`SelectItem`, `AggregateSelectable`, оконный вариант)
- `packages/sql-pg/src/sql-generator.ts` (рендер select-листа)

**Коммиты:** `db7f6fe` (C1 — рендер агрегатов в адаптер, `toSql` убран из sql-types контракта), `6e17165` (C2 — FuncField base, select entry `{agg}`, phantom `~result` indexed-access фикс), `d762875` (C3 — AST окон: `WindowField`/`WindowSpec`, фабрика `wf`, `AggregateField.over()`, `SelectTools {agg,wf}` / `ReturningTools {agg}`; +10 core unit-тестов), `d33a339`+`bc117fc` (C4/C5 — рендер окон в sql-pg: `WindowSelectable`, `_renderWindow`/`_renderOverClause`/`_renderFrameBound`, парам-аргументы `$N`; +10 sql-pg unit-тестов; коррекция: ORDER BY только для 4 рангов).

---

## F1: Нет upsert (INSERT ... ON CONFLICT)

**Важность:** 🟡 High

**Краткое описание:** Нет поддержки upsert-операций. Приходится делать select + update/create в two-step.

**Статус:** ✅ Реализовано. `create()` и `createMany()` возвращают финализаторы с `.onConflict()`, `.doNothing()`, `.go()`.

**API:**
```typescript
// Insert
orm.single(User).create(data).go()

// Upsert (ON CONFLICT DO UPDATE)
orm.single(User).create(data).onConflict(t => [t.email]).go()

// Upsert (ON CONFLICT DO NOTHING)
orm.single(User).create(data).onConflict(t => [t.email]).doNothing().go()

// Batch upsert
orm.single(User).createMany([...]).onConflict(t => [t.email]).go()
```

**Коммиты:** `933bcb6` (sql-types), `b4c9c73` (core AST), `04e5502` (sql-generator), `703222b` (core builders), `719a38c` (pg adapter), `29a250f` (tests)

---

## F2: Нет raw() в ORM-слое

**Важность:** 🟢 Medium

**Краткое описание:** `raw()` доступен только через адаптер (`appCore.sqlAdapter.raw()`). В ORM-слое нет доступа к сырым запросам.

**Статус:** ⬜ Открыто. `raw()` доступен через `appCore.sqlAdapter.raw()`, но не через `orm.single()`. Добавление в OrmManager — минимальный риск.

**Связанные файлы:**
- `packages/core/src/orm/orm.ts`
- `packages/sql-types/src/index.ts`

**Коммит:**

---

## F3: Нет having() для агрегатных фильтров

**Важность:** 🟡 High

**Краткое описание:** Нет поддержки `HAVING` clause. Невозможно фильтровать по результатам агрегатных функций.

**Пример:**
```typescript
// Хочу: HAVING COUNT(*) > 5
orm.single(Order)
  .select(t => [t.userId, aggregates.count('*').as('cnt')])
  .groupBy(t => [t.userId])
  // .having(t => t.cnt.gt(5)) — не существует
  .go();
```

**Статус:** ✅ Ready. Реализовано в `fc904cc` (core: `having()`) + сл. коммит (fix: HAVING рендерится полными агрегатными выражениями; + `havingOr()`/`havingGroup()` для OR/групп).

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/query-proxies.ts`
- `packages/core/src/orm/builders/where-helpers.ts` (`withChildGroup`)
- `packages/core/src/orm/sqb.ts`
- `packages/sql-pg/src/sql-generator.ts`
- `packages/sql-types/src/index.ts` (ReadonlySqb, AggregateSelectable.func)
- `test-project/test/orm/having.test.ts`

**Коммит:**

---

## F4: Нет transaction() в standalone orm ✅

**Статус:** ✅ Closed as moot — standalone `orm` удалён (D5). Транзакции доступны на `OrmManager.transaction()`; потребность закрыта.

**Важность:** ⚪ Low

**Краткое описание:** `orm.transaction()` доступен только в `OrmManager`. Standalone `orm` не поддерживает транзакции.

**Риски изменений:**
- Прокинуть adapter в standalone orm — потребует изменений в API
- Добавить `orm.transaction(adapter, callback)` — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/orm.ts`

**Коммит:** `8fb4bf9` (закрыто через D5)

---

## F5: Нет cursor-based пагинации

**Важность:** 🟢 Medium

**Краткое описание:** Только offset-based пагинация (`page()`, `limit()`, `offset()`). Для больших таблиц offset медленный.

**Статус:** ✅ Реализовано. `.cursor(fn)` — keyset-пагинация на базе WHERE-выражений (оба плана в `plans/builder-expression.md`). Отдельный AST-узел `sqb.cursor: WhereGroup`; дирекция — оператором (`gt/lt`), инклюзивность — `gte/lte/eq`; multi-key через `or/and`; guard'ы: `order()` обязателен, `offset()/page()` конфликтуют, второй `cursor()` — ошибка. `before()` — вне scope MVP.

**Риски изменений:**
- Добавить `cursor()` метод — потребовал изменения в SqlGenerator (рендер AND-члена в селект-пути)
- Использовать where + order — workaround, но ручной
- Риск: средний

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/sql-pg/src/sql-generator.ts`

**Коммит:** `0dcc309` (`.cursor()` + AST-узел + guards; тесты core/sql-pg/test-project)

### Подготовка: новый API `.order` (breaking)

`order()` переведён на массив направлений per-field: `order(u => [u.id.asc, u.name.desc])` вместо `order(fn, dir)`. Это предпосылка F5: `sqb.orders[]` несёт полный упорядоченный список ключей, keyset = row-value сравнение `(k1, k2) > ($1, $2)`.

Реализовано в `6395f0c`:
- `OrderDirection { tableAlias, fieldName, column?, direction }` — создаётся флагом `u.id.asc` / `u.id.desc`
- `OrderField { ..., asc, desc }` — больше не «голое» направление
- `createOrderProxy` возвращает объекты с `.asc`/`.desc`; `MultiOrderProxy<T>` для multi-запросов
- `single()`, `multi()`, `Relation.order()` единый сигнатуру `(t) => OrderDirection[]`
- Разобраны вызовы в core/tests и test-project

### Подготовка: WHERE-выражения (breaking) — предпосылка `.cursor()`

Keyset по нескольким ключам требует вложенности `AND` внутрь `OR` — `(k1 > $1) OR (k1 = $1 AND k2 < $2)`. Старый DSL (плоские `or`/`group`) это не выражал. Поэтому перед `.cursor()` сделан рефакторинг композиции: билдеры `where/and/or/having/havingOr` пушат плоские шаги, вложенные группы — только выражениями `and()`/`or()` (рендер — минимальные скобки). Описание и полный план — `plans/builder-expression.md`.

Реализовано в `8c1bae7`.

---

## F6: Нет createMany() / updateMany() / deleteMany()

**Важность:** 🟡 High

**Краткое описание:** Нет batch-операций. Приходится делать цикл с одиночными запросами.

**Статус:** ✅ createMany() реализован. update/delete уже работают как mass-операции через WHERE.

**Дополнительно:**
- `createMany()` с автотранзакцией при >1000 строк (`{ transaction: true }` по умолчанию)
- `createMany()` возвращает финализатор с `.onConflict()`, `.doNothing()`, `.go()`

**Коммиты:** `328c732` (sql-types), `5f82635` (sql-pg), `0bf0748` (core), `47245f8` (tests), `2138569` (docs), `933bcb6` (options), `719a38c` (transaction), `29a250f` (tests)

---

## F7: Нет count() с фильтрами

**Важность:** ⚪ Low

**Краткое описание:** `count()` работает только как терминальная операция. Невозможно сделать `where(...).count()` без вызова `select()`.

**Пример:**
```typescript
// Хочу:
orm.single(User).where(t => t.active.eq(true)).count().go();
// Приходится:
orm.single(User).where(t => t.active.eq(true)).count().go(); // работает, но count() перезаписывает select
```

**Статус:** ✅ Решено вместе с A1 (`b709ad1`). Апдейт `Updated 2026-09-08`: `count()` работает на снапшоте `sqb.clone()` — комбинация `where(...).count().go()` возвращает верное число, а select билдера больше не перезаписывается (последующий `go()` возвращает строки, а не колонку count). Интеграционный тест `where.test.ts` («count() combines with where...»).

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts` (count)

**Коммит:**
