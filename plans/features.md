# Отсутствующие фичи

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — F1 resolved, F6 updated.
> Updated 2026-09-07 — verified F1, F6 still resolved. F7 updated. F8 added.
> Updated 2026-09-08 — F7 resolved via A1 (`b709ad1`).

---

## F8: Нет оконных функций (window functions)

**Важность:** 🟢 Medium

**Краткое описание:** Нет поддержки `OVER ()` — партиционирование, порядок, нумерация строк (`ROW_NUMBER`, `RANK`, `LAG`, `NTILE`...) и агрегатов по окну (`SUM(col) OVER (...)`).

**Статус:** ⬜ Открыто. Агрегаты реализованы, но без `over()`. API выбрано (вариант A), реализация отложена.

**Выбранный API (вариант A — третий параметр `wf`):**
```typescript
select((u, aggs, wf) => [
  u.id,
  aggs.count().as('total'),                                    // COUNT(*)
  aggs.sum(u.amount).over(w => w.orderBy(u.createdAt)).as('runningTotal'), // SUM(amount) OVER (ORDER BY ...)
  wf.rowNumber().as('rn'),                                     // ROW_NUMBER() OVER ()
  wf.rowNumber().over(w => w.partitionBy(u.deptId).orderBy(u.createdAt, 'desc')).as('rn'),
  wf.rank().as('rank'),
  wf.lag(u.price, 1).as('prevPrice'),
  wf.ntile(4).as('quartile'),
])
```

**Обоснование варианта A:** не ломает существующий код `(t, aggs)` — новый параметр добавляется третьим. Вариант B (`{ aggs, wf }`) отклонён: breaking change. Вариант C (всё в `aggs`) отклонён: смешивает агрегаты и оконные функции.

**Диапазон функций:**
- Нумерация/ранг: `row_number()`, `rank()`, `dense_rank()`, `ntile(n)`
- Смещение: `lag(col, n)`, `lead(col, n)`
- Значение: `first_value(col)`, `last_value(col)`
- Агрегат с окном: `aggs.sum(col).over(w => ...)`, `aggs.count().over(w => ...)`

**Изменения:**
- AST: новый класс `WindowField` с `toSql()` → рендер `FUNC(...) OVER (PARTITION BY ... ORDER BY ...)`
- `WindowSpec` builder: `.partitionBy(...)`, `.orderBy(...)`, `.rowsBetween(...)`
- Типы: `WindowFunctions` в сигнатуре `select()`/`first()`/`.returning()` как третий параметр
- **Рендер через `sel.toSql()`** — чтобы новый AST-узел рендерился без правок SqlGenerator (линкается с решением для `.returning()`)

**Связанные файлы:**
- `packages/core/src/orm/field-builders/aggregates.ts`
- `packages/core/src/orm/ast/aggregate.ts` (переиспользование паттерна)
- `packages/core/src/orm/types/proxy.d.ts` (сигнатура select/first)
- `packages/sql-pg/src/sql-generator.ts` (рендер, вероятно не потребуется если `toSql()`)

**Коммит:**

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
