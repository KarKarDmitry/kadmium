# Проблемы безопасности

> Generated 2026-09-04 from `packages/core/src/orm/` review.
> Updated 2026-09-11 — S7 verdict: won't fix (DEFAULT — SQL-выражение, требуется SQL-парсер; пересмотреть при недоверенном вводе в DDL).
> Updated 2026-09-05 — added importance fields.
> Updated 2026-09-07 — S1 resolved (`04ee7e1`), S2 resolved, S3 reframed as part of A1.
> Updated 2026-09-08 — S3 resolved via A1 (B+C, `b709ad1`).

---

## S1: Глобальный мутабельный стейт pgTypes

**Важность:** 🟡 High

**Краткое описание:** `pgTypes.setTypeParser(20, ...)` — глобальный мутабельный стейт в `node-postgres`. Конфликт с другими библиотеками, использующими `pg`. Если другая библиотека переопределит этот парсер — поведение изменится.

**Статус:** ✅ Решено в `04ee7e1`. Глобальный парсер заменён per-pool `createKadmiumTypes()` (`packages/sql-pg/src/index.ts:101-115`): int8 (oid 20) обрабатывается кастомным парсером на инстанс пула, остальные OID делегируются в `pgTypes.getTypeParser`. `types: createKadmiumTypes()` передаётся в `new Pool(...)` при конструировании адаптера.

**Связанные файлы:**
- `packages/sql-pg/src/index.ts`

**Коммит:** `04ee7e1`

---

## S2: DDL интерполирует spec.db_type/defaultValue raw

**Важность:** 🟡 High

**Краткое описание:** DDL-операции интерполируют `spec.db_type`/`dataType`, `defaultValue`, `newType`, `onDelete`/`onUpdate` и имена таблиц/колонок напрямую в SQL. Это trusted dev source, но валидации нет — возможна инъекция через кастомные типы/дефолты.

**Пример:**
```typescript
f.string({ db_type: "text; DROP TABLE users; --" })
```

**Ограничение:** Postgres **не поддерживает bind-параметры в DDL** (`SET DEFAULT $1`, `TYPE $1` недопустимы) → фикс — строгая валидация при сборке SQL, а не параметризация.

**Статус:** ✅ Решено. Новый модуль `packages/sql-pg/src/ddl-validate.ts`:
- `assertSqlIdentifier()` — имена таблиц/колонок/индексов/FK: allowlist `[A-Za-z_][A-Za-z0-9_]{0,62}`
- `assertSqlExpression()` — `dataType`/`defaultValue`/`newType`: allowlist-символы + запрет `;`, комментариев, управляющих символов + баланс скобок/кавычек
- `assertReferentialAction()` — `ON DELETE/UPDATE`: allowlist `NO ACTION | CASCADE | SET NULL | RESTRICT | SET DEFAULT`
- `assertDiffOpSqlSafe()` — превью-путь `renderSql`

Барьер — `PgDdlAdapter` (исполняемый путь `applyDiff → adapter.*`, `core/src/cli/db.ts:107`): валидация во всех мутирующих методах (`createTable`, `addColumn`, `dropColumn`, `alterType`, `alterNullable`, `alterDefault`, `addIndex`, `dropIndex`, `addForeignKey`, `dropForeignKey`, `dropTable`). Превью `renderSql` (`diff/render.ts`) валидирует те же поля, чтобы ловить ошибку на этапе генерации миграции.

**Связанные файлы:**
- `packages/sql-pg/src/ddl-validate.ts` (создан)
- `packages/sql-pg/src/ddl-adapter.ts`
- `packages/sql-pg/src/diff/render.ts`
- `packages/sql-pg/test/ddl-validate.test.ts` (создан)

**Коммит:** `8a93983`

---

## S3: _or() — race condition при параллельном использовании

**Важность:** 🟢 Medium

**Краткое описание:** `_or()` мутировал `sqb.wheres.op` в `SingleQueryBuilder`. При параллельном использовании одного builder'а — race condition.

**Статус:** ✅ Решено вместе с A1 (`b709ad1` + PR2). Конфиг-вызовы (`where`/`or`/`limit`/`order`) по-прежнему мутируют `this.sqb` in-place — состояние строится в одном потоке до терминала. Терминалы работают на снапшоте (`sqb.clone()`), поэтому параллельный `go()`/`count()`/`exists()` на одном builder'е больше не гоняется за общий мутируемый стейт. Для безопасного ветвления одного билдера в несколько запросов — публичный `.clone()`.

**Связанные файлы:**
- `packages/core/src/orm/builders/where-helpers.ts` (addOrCondition)
- `packages/core/src/orm/builders/single.ts`
- `packages/core/src/orm/builders/multi.ts`

---

## S5: expression.op интерполируется в SQL без runtime-валидации

**Важность:** 🟡 High — ✅ **Done** (`6572887`)

**Краткое описание:** `sql-generator.ts:117` интерполирует `expression.op` напрямую в SQL (`${left} ${expression.op} ${right}`). Тип `op` ограничен на уровне TS, но runtime-валидации нет. Если тип будет расширен — вектор SQL-инъекции.

**Решение:** Allowlist `export const VALID_OPS = new Set(['=', '!=', '>', '>=', '<', '<=', 'LIKE', 'ILIKE', 'IN', 'BETWEEN', 'IS NULL', 'IS NOT NULL'])`; **runtime guard** в `_renderCondition` (throw `Unsupported operator: ...`) — покрывает `_renderWhereExpression` и `_buildConditionSql` (все связанные операторы сравнения включены: `=, !=, >, >=, <, <=, BETWEEN, LIKE, ILIKE, IN, IS NULL, IS NOT NULL`). Note: this supersedes A1's `_or()` race fix mention — `op` теперь закрыт на уровне генератора.

**Связанные файлы:**
- `packages/sql-pg/src/sql-generator.ts` (VALID_OPS, `_renderCondition`)
- `packages/sql-pg/test/sql-generator/where-clause.test.ts` (throw-test)

---

## S6: Нет валидации идентификаторов в DML-пути

**Важность:** 🟡 High — ✅ **Done** (`aa29c92`)

**Краткое описание:** DDL-путь использует `assertSqlIdentifier()`. DML-путь (`buildInsertSql`, `buildInsertManySql`, `buildUpsertManySql`) интерполирует `collectionName` и имена колонок с кавычками, но без проверки. Маловероятно (collectionName из IR), но нарушает defense-in-depth.

**Решение:** `assertSqlIdentifier(collectionName, 'collection name')` в начало каждого build-хелпера. Тесты (`build-helpers.test.ts`): hostile collection name кидает `/Invalid SQL identifier/` на insert / insert-many / upsert путях — **без БД** (throw до query, Pool ленивый).

**Связанные файлы:**
- `packages/sql-pg/src/index.ts`
- `packages/sql-pg/test/build-helpers.test.ts` (создан)

---

## S7: pg_sleep() возможен через DEFAULT в DDL

**Важность:** 🟢 Low

**Краткое описание:** `assertSqlExpression` разрешает буквы и скобки → `pg_sleep(10)` проходит валидацию. DoS через DEFAULT теоретически возможен, маловероятен (только DDL, trusted source).

**Решение (акцептировано, won't fix):** DEFAULT — это SQL-выражение, а не просто строка; корректная валидация требует SQL-парсера. Соотношение затрат/риска не оправдывает зависимость от парсера (только DDL, trusted source). Зафиксировано как осознанный trade-off; пересмотреть при появлении недоверенного входа в DDL.

**Связанные файлы:**
- `packages/sql-pg/src/ddl-validate.ts` (line 17)

---

## S8: False positive на экранированные кавычки в ddl-validate — ✅ **Done** (`ea589e2`)

**Краткое описание:** Балансировка кавычек не обрабатывала `''` (escaped quotes). Валидный SQL `'it''s'` давал «несбалансированный синтаксис`.

**Решение:** в `assertSqlExpression` при `ch === quote` и `expr[i+1] === quote` — пара `''` не закрывает строку (skip обе). Регресс-тесты: `'it''s'`, `"a""b"`, `'it''s' AND 'x''y'` валидны; несбалансированные по-прежнему кидают.

**Связанные файлы:**
- `packages/sql-pg/src/ddl-validate.ts`
- `packages/sql-pg/test/ddl-validate.test.ts`