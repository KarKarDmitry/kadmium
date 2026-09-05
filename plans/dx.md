# Проблемы DX / отладки

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

---

## D1: toSql() выбрасывает ошибку без адаптера

**Важность:** 🟡 High

**Краткое описание:** `toSql()` выбрасывает ошибку, если адаптер не настроен. Невозможно посмотреть SQL без подключения к БД. Усложняет отладку и тестирование.

**Пример:**
```typescript
const q = orm.single(User).where(t => t.name.eq('Alice'));
console.log(q.toSql());
// Error: No SQL adapter configured
```

**Риски изменений:**
- Добавить standalone `renderSql(sqb)` в sql-types — безопасно, но потребует реализации в адаптерах
- Добавить fallback-рендерер в core — безопасно, но дублирование
- Риск: минимальный

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts` (toSql)
- `packages/core/src/orm/builders/multi.ts` (toSql)
- `packages/sql-types/src/index.ts`

**Коммит:**

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

**Краткое описание:** Нет механизма для логирования SQL-запросов. В production невозможно отследить, что отправляется в БД.

**Риски изменений:**
- Добавить hook/logger в SqlAdapter — безопасно
- Добавить `debug` опцию в PgAdapter — безопасно
- Риск: минимальный

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (PgAdapter)
- `packages/sql-types/src/index.ts` (SqlAdapter)

**Коммит:**

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
