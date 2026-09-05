# Проблемы безопасности

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-05 — added importance fields.

---

## S1: Глобальный мутабельный стейт pgTypes

**Важность:** 🟡 High

**Краткое описание:** `pgTypes.setTypeParser(20, ...)` — глобальный мутабельный стейт в `node-postgres`. Конфликт с другими библиотеками, использующими `pg`. Если другая библиотека переопределит этот парсер — поведение изменится.

**Риски изменений:**
- Использовать индивидуальный pool с кастомными типами — безопасно, но复杂нее
- Документировать ограничение — минимум риска
- Риск: средний, конфликт возможен в сложных проектах

**Связанные файлы:**
- `packages/sql-pg/src/index.ts` (строка 24-26)

**Коммит:**

---

## S2: DDL интерполирует spec.db_type/defaultValue raw

**Важность:** 🟡 High

**Краткое описание:** DDL-операции интерполируют `spec.db_type` и `defaultValue` напрямую в SQL. Хотя это trusted dev source, нет валидации. Возможна инъекция через кастомные типы.

**Пример:**
```typescript
f.string({ db_type: "text; DROP TABLE users; --" })
```

**Риски изменений:**
- Добавить валидацию db_type/defaultValue — безопасно
- Использовать parameterized queries для DDL —复杂нее
- Риск: средний, хотя это dev-time source

**Связанные файлы:**
- `packages/sql-pg/src/diff.ts` (renderSql, renderDefault)
- `packages/sql-pg/src/ddl-adapter.ts`

**Коммит:**

---

## S3: _or() — race condition при параллельном использовании

**Важность:** 🟢 Medium

**Краткое описание:** `_or()` в `SingleQueryBuilder` мутирует `sqb.wheres.op`. При параллельном использовании одного builder'а — race condition.

**Пример:**
```typescript
const q = orm.single(User);
// Параллельно:
Promise.all([
  q.or(t => t.name.eq('Alice')).go(), // мутирует q.sqb.wheres
  q.or(t => t.name.eq('Bob')).go(),  // конфликт
]);
```

**Риски изменений:**
- Документировать "не переиспользовать builder" — минимум риска
- Сделать _or() immutable —复杂нее
- Риск: низкий, но возможен в async коде

**Связанные файлы:**
- `packages/core/src/orm/builders/single.ts` (_or)

**Коммит:**
