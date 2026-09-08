# Проблемы типизации

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — corrected T1 (proxy type-safety works correctly).
> Updated 2026-09-07 — T2 resolved (`ff30dc1`), T4 resolved (`657db49`).
> Updated 2026-09-08 — added T5 (duplicated type helpers), from project review.

---

## T1: Proxy type-safety — работает через mapped types

**Краткое описание:** Type-safety в proxy обеспечивается **на уровне TypeScript** через mapped types в `proxy.d.ts`, а не через runtime `has` trap. `FilterProxy<T>`, `SelectProxy<T>`, `OrderProxy<T>`, `RelationProxy<T>` — все построены как `{ [K in keyof TModel['~shape']]-?: ... }`. Несуществующее поле — ошибка TS2339 на этапе компиляции.

**Runtime Proxy** — это safety net для динамических случаев (когда тип неизвестен на этапе компиляции). `get` trap проверяет `ir.fields[field]` и бросает ошибку.

**Статус:** Работает как задумано. Дополнительные действия не требуются.

**Связанные файлы:**
- `packages/core/src/orm/types/proxy.d.ts` (mapped types)
- `packages/core/src/orm/builders/single.ts` (_createFilterProxy, _createSelectProxy — runtime get trap)

---

## T2: UpdateFinalizer возвращает все поля

**Важность:** 🟡 High

**Краткое описание:** `UpdateFinalizer<TModel>` возвращает `Promise<TModel['~shape'][]>` — всегда все поля. Нет механизма для `RETURNING` конкретных полей.

**Статус:** ✅ Решено в `ff30dc1`. Добавлен `.returning((t, aggs) => [...])` в `update()`/`delete()` (на финализаторе и после `.where()`). Проекция рендерится через `sel.toSql()`. Агрегаты генерируют RETURNING, но Postgres запрещает их исполнение (42803) — окно для будущих оконных функций (F8).

**Пример:**
```typescript
// Хочу вернуть только id и name, а не все 20 полей
await orm.single(User).update({ name: 'Bob' }).where(t => t.id.eq(1)).go();
// Возвращает { id, name, email, password, createdAt, ... } — все поля
```

**Риски изменений:**
- Добавить `.returning()` метод в `UpdateFinalizer` — потребует изменений в SqlGenerator
- Оставить как есть — минимум риска, но неэффективно

**Связанные файлы:**
- `packages/core/src/orm/types/proxy.d.ts` (UpdateFinalizer)
- `packages/core/src/orm/builders/single.ts` (update, delete)
- `packages/sql-pg/src/sql-generator.ts` (_buildUpdateQuery, _buildDeleteQuery)

**Коммит:**

---

## T3: SelectProxy не различает select() и first()

**Важность:** ⚪ Low

**Краткое описание:** Тип `SelectProxy<TModel>` идентичен для `select()` и `first()`, но поведение разное (first добавляет LIMIT 1). TypeScript не может это выразить.

**Риски изменений:**
- Минимальные — это ограничение TypeScript, не баг
- Можно добавить JSDoc-комментарии

**Связанные файлы:**
- `packages/core/src/orm/types/proxy.d.ts`
- `packages/core/src/orm/builders/single.ts`

**Коммит:**

---

## T5: GetFieldName / GetFieldType определены дважды — divergent trap

**Важность:** 🟡 High

**Краткое описание:** Два публичных типа `GetFieldName` / `GetFieldType` определены в двух местах с **разными реализациями** разрешения алиаса:

- `packages/core/src/orm/types/proxy.d.ts:208-225` — использует `SelectableField<any, any, infer AL, any>` (**4 type params**, alias-aware)
- `packages/core/src/orm/types/includes.d.ts:45-62` — использует `SelectableField<any, any, infer A>` (**3 type params**)

**Пример divergence (GetFieldType):**
```typescript
// proxy.d.ts
S extends SelectableField<infer T, any, any, any> ? T : never;
// includes.d.ts
S extends SelectableField<infer T, any, any> ? T : unknown;  // fallback = unknown, а не never
```

Публичные версии (через `public-types.d.ts` ← `orm/index.ts:34-35`) берутся из **proxy**, а внутренние `FlatFinalResult` / `QueryResult` — из **includes**. Два определения одного публичного имени, которые могут разрешать алиасы по-разному, — молчаливый риск drift типов: сгенерированные row-типы могут разойтись по разным путям импорта.

**Решение:** Свести к одному каноническому определению и re-export из него. Проверить, что `SelectableField` consistently принимает 4 type params (иначе уточнить в обоих местах скопом).

**Статус:** ✅ Решено в `c0a60e6` — каноническое определение GetFieldName/GetFieldType в `proxy.d.ts` (4 type-param, fallback `never`), `includes.d.ts` re-exports; удалён локальный дубликат из `aggregates.ts` и мёртвый `ExtractIncludeAlias`. Публичный путь (`public-types → includes`) сохранён.

**Связанные файлы:**
- `packages/core/src/orm/types/proxy.d.ts` (GetFieldName/GetFieldType:208-225)
- `packages/core/src/orm/types/includes.d.ts` (GetFieldName/GetFieldType)
- `packages/core/src/orm/field-builders/aggregates.ts` (локальная копия)

**Коммит:** `c0a60e6`

---

## T4: typecheck падает — `foreignKey` не существует на `StandardField`

**Важность:** 🔴 Critical

**Краткое описание:** `packages/core/test/model/model.test.ts:44` — ошибка компиляции: `Property 'foreignKey' does not exist on type 'StandardField'`. Блокирует `npm run check:type`.

**Статус:** ✅ Решено в `657db49` — тип поля приведён к `ReferenceField`.

**Связанные файлы:**
- `packages/core/test/model/model.test.ts:44`

**Коммит:** `657db49`
