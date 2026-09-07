# Отсутствующие фичи

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — F1 resolved, F6 updated.
> Updated 2026-09-07 — verified F1, F6 still resolved. F7 updated. F8 added.

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

**Статус:** ⬜ Открыто. Потребует изменений в AST (`sqb.ts`), `SqlGenerator`, и query builders.

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/sqb.ts`
- `packages/sql-pg/src/sql-generator.ts`
- `packages/sql-types/src/index.ts` (ReadonlySqb)

**Коммит:**

---

## F4: Нет transaction() в standalone orm

**Важность:** ⚪ Low

**Краткое описание:** `orm.transaction()` доступен только в `OrmManager`. Standalone `orm` не поддерживает транзакции.

**Риски изменений:**
- Прокинуть adapter в standalone orm — потребует изменений в API
- Добавить `orm.transaction(adapter, callback)` — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/orm.ts`

**Коммит:**

---

## F5: Нет cursor-based пагинации

**Важность:** 🟢 Medium

**Краткое описание:** Только offset-based пагинация (`page()`, `limit()`, `offset()`). Для больших таблиц offset медленный.

**Риски изменений:**
- Добавить `cursor()` метод — потребует изменений в SqlGenerator
- Использовать where + order — workaround, но ручной
- Риск: средний

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/sql-pg/src/sql-generator.ts`

**Коммит:**

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

**Статус:** ⬜ Открыто. `count()` работает через `select(aggregates.count('*'))`, но API неудобен — count() перезаписывает select и не даёт комбинировать с where без промежуточного select().

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts` (count)

**Коммит:**
