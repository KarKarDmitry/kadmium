# Проблемы DX / отладки

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.
> Updated 2026-09-07 — D1, D3 resolved.
> Updated 2026-09-08 — added D5 (standalone orm unusable), from project review.

---

## D1: toSql() выбрасывает ошибку без адаптера

**Важность:** 🟡 High

**Статус:** ✅ Реализовано. `createDebugAdapter()` в `sql-pg` — SqlAdapter без подключения к БД. Ошибка при отсутствии адаптера теперь подсказывает импорт.

**Пример:**
```typescript
import { createDebugAdapter } from '@karkardmitry/kadmium-sql-pg';

const adapter = createDebugAdapter();
orm.single(User, adapter).where(u => u.name.eq('Alice')).toSql();
// → SQL: SELECT "users"."id" AS "id" ... WHERE "users"."name" = $1
// → VALUES: ['Alice']
```

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (createDebugAdapter)
- `packages/core/src/orm/builders/single.ts` (улучшенное сообщение ошибки)
- `packages/core/src/orm/builders/multi.ts` (улучшенное сообщение ошибки)

---

## D2: Ошибки в include — только рантайм

**Важность:** 🟢 Medium

**Краткое описание:** Ошибки в include (неправильное имя связи) выбрасываются в рантайме: `throw new Error('Relation "X" not found in Y')`. TypeScript не предупреждает для динамических обращений. Однако для статически типизированных include — type-safety работает через mapped types в `RelationProxy<T>`.

**Пример:**
```typescript
// Опечатка: 'postt' вместо 'posts'
orm.single(User).include(t => [t.postt]).go();
// Runtime: Error: Relation "postt" not found in User
```

**Риски изменений:**
- Генерировать типы RelationProxy из IR — решает, но сложно
- Добавить JSDoc — улучшает DX, но не решает
- Риск: средний, потребует изменений в type-level логике

**Связанные файлы:**
- `packages/core/src/orm/field-builders/relation.ts`
- `packages/core/src/orm/types/proxy.d.ts` (RelationProxy)
- `packages/core/src/ir/index.ts` (FieldIR)

**Коммит:**

---

## D3: Нет logging/debugging сгенерированного SQL

**Важность:** 🟡 High

**Статус:** ✅ Реализовано. Опция `logger` в `PgAdapterConfig`. Вызывается перед каждым запросом в `PgAdapter.execute()` и `TransactionalPgAdapter.execute()`.

**Пример:**
```typescript
const adapter = new PgAdapter({
  host: 'localhost',
  database: 'mydb',
  logger: (sql, params) => console.log(sql, params),
});
```

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (PgAdapterConfig, PgAdapter, TransactionalPgAdapter)

---

## D5: Standalone orm — нерабочий (adapter никогда не получает) ✅

**Статус:** ✅ Resolved — standalone `orm` + `standaloneCache` удалены (`orm.ts`); добавлен `OrmManager.withAdapter(adapter)` для запросов через конкретный adapter; JSDoc `createDebugAdapter` переписан на каноничный путь `KadmiumApp` + `modules.sql`. F4 (transaction в standalone orm) закрыт как moot — транзакции на `OrmManager.transaction()`.

**Важность:** 🟡 High

**Краткое описание:** Экспортируемый standalone `orm` из `packages/core/src/orm/orm.ts:152-169` строит `SingleQueryBuilder`, **не передавая adapter**:

```typescript
export const orm = {
  single<TModel>(modelClass, ir?): SingleQueryBuilder<TModel> {
    // ...
    return new SingleQueryBuilder<TModel>(compiled, buildIrLookup()); // ← 2 арг., adapter не передан
  },
};
```

`SingleQueryBuilder` по умолчанию ставит `adapter = null` (`single.ts:52,62`). Из-за этого **ни один терминальный метод не работает** — все бросают `"No adapter configured"`:
- `go()` (`single.ts:339`)
- `toSql()` (`single.ts:415-418`) — даже SQL preview требует реальный adapter
- `create()`, `createMany()`, `count().go()`, `exists().go()`

**Важное уточнение:** тесты проект **не** ломаются — они используют `OrmManager` через `makeHarness()` (`test-project/test/helpers.ts:35-45`), а не standalone `orm`. Также standalone `orm` не экспортируется из главной точки входа (`packages/core/src/index.ts` экспортирует только `OrmManager`) и не покрыт тестами. Т.е. это **неактивный мёртвый/недоделанный API**, а не активная поломка.

**JSDoc-путаница:** `createDebugAdapter()` JSDoc (`sql-pg/src/index.ts`) показывает `orm.single(User, adapter)` — но второй параметр standalone `orm` это `ModelIR`, не adapter. Пример некорректен.

**Решение (выбрать одно):**
1. **Удалить** standalone `orm` — поскольку не экспортируется и не используется; направить пользователей на `new OrmManager(...)` / `KadmiumApp`.
2. **Допилить** — дать ему принимать adapter (`orm.single(User, adapter)`), прокидывать в `SingleQueryBuilder`, и экспортировать публично.
3. **Починить примеры/JSDoc** — даже если оставить, `toSql()` без adapter не работает, так что пример в `createDebugAdapter` JSDoc вводит в заблуждение.

**Связанные файлы:**
- `packages/core/src/orm/orm.ts` (standalone orm:152-169, standaloneCache:150)
- `packages/core/src/orm/builders/single.ts` (adapter null default, throw)
- `packages/core/src/orm/index.ts` (export `orm`)
- `packages/sql-pg/src/index.ts` (createDebugAdapter JSDoc)
- `packages/core/src/index.ts` (НЕ экспортирует `orm`)

**Коммит:** `8fb4bf9`

---

## D4: Нет explain() для проверки плана запроса

**Важность:** ⚪ Low

**Краткое описание:** Невозможно проверить план выполнения запроса без ручного SQL. Усложняет оптимизацию производительности.

**Риски изменений:**
- Добавить `explain()` метод в QueryBuilder — безопасно
- Использовать `EXPLAIN ANALYZE` через raw() — безопасно, но ручное
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`
- `packages/sql-pg/src/index.ts`

**Коммит:**
