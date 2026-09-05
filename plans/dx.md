# Проблемы DX / отладки

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

---

## D1: toSql() выбрасывает ошибку без адаптера

**Важность:** 🟡 High

**Статус:** ✅ Добавлен `createDebugAdapter()` в `sql-pg` — SqlAdapter без подключения к БД. Ошибка при отсутствии адаптера теперь подсказывает импорт.

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

**Коммит:** (pending)

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

**Статус:** ✅ Добавлена опция `logger` в `PgAdapterConfig`. Вызывается перед каждым запросом в `PgAdapter.execute()` и `TransactionalPgAdapter.execute()`.

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

**Коммит:** (pending)

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
