# Отсутствующие фичи

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

---

## F1: Нет upsert (INSERT ... ON CONFLICT)

**Важность:** 🟡 High

**Краткое описание:** Нет поддержки upsert-операций. Приходится делать select + update/create в two-step.

**Риски изменений:**
- Добавить `upsert()` метод в SingleQueryBuilder — потребует изменений в SqlGenerator
- Использовать raw() — unsafe, нет parameterization
- Риск: средний, потребует изменений в нескольких слоях

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/sql-pg/src/sql-generator.ts`
- `packages/sql-pg/src/index.ts`

**Коммит:**

---

## F2: Нет raw() в ORM-слое

**Важность:** 🟢 Medium

**Краткое описание:** `raw()` доступен только через адаптер (`appCore.sqlAdapter.raw()`). В ORM-слое нет доступа к сырым запросам.

**Риски изменений:**
- Добавить `raw()` в OrmManager — безопасно
- Прокинуть adapter в standalone orm — безопасно
- Риск: минимальный

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

**Риски изменений:**
- Добавить `having()` в QueryBuilder + SqlGenerator — потребует изменений в AST
- Использовать子запрос — workaround, но неудобно
- Риск: средний, потребует изменений в AST и SqlGenerator

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

**Коммиты:** `328c732` (sql-types), `5f82635` (sql-pg), `0bf0748` (core), `47245f8` (tests), `2138569` (docs)

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

**Риски изменений:**
- Минимальные — count() уже работает через select + aggregate
- Улучшить API — безопасно

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts` (count)

**Коммит:**
