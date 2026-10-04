# @karkardmitry/kadmium-sql-pg

> PostgreSQL adapter for Kadmium ORM.

## Purpose

Implements `SqlAdapter` from `@karkardmitry/kadmium-sql-types` for PostgreSQL using `node-postgres` (pg).

## Architecture

```
PgAdapter (SqlAdapter)
├── extends SqlGenerator (SQL generation)
├── Pool (connection pool)
├── PgDdlAdapter (DDL operations)
└── ResultReshaper (flat → nested results)

TransactionalPgAdapter (TransactionalAdapter)
├── extends SqlGenerator
├── PoolClient (single connection)
└── commit/rollback/end
```

## Key Files

| File | Purpose |
|------|---------|
| `index.ts` | PgAdapter, TransactionalPgAdapter, unpackIncludes |
| `sql-generator.ts` | SqlGenerator — AST → PostgreSQL SQL |
| `result-reshaper.ts` | Flat PG rows → nested objects |
| `ddl-adapter.ts` | PgDdlAdapter — schema introspection + DDL |
| `diff.ts` | Schema diffing (computeDiff, applyDiff, renderSql) |

## SQL Generation (`sql-generator.ts`)

PostgreSQL-specific:
- **`json_agg`** / **`row_to_json`** — include as JSON columns
- **`LEFT JOIN LATERAL`** — includes as lateral subqueries
- **`$1`, `$2`...** — parameterized queries
- **`RETURNING`** — on UPDATE/DELETE/INSERT/UPSERT. Формат INSERT задан единственным `renderInsert()` (экспорт из `sql-generator.ts`); `buildInsertSql`/`buildInsertManySql`/`buildUpsertManySql` и `_buildUpsertQuery` вызывают его и не собирают текст сами. Клауза передаётся колбэком (`renderReturning`), а не строкой — выражения в RETURNING (окна, агрегаты, `sql-item`) продолжают нумерацию `$N` после VALUES и ON CONFLICT. **Квалификация колонок различается по операции**: у UPDATE/DELETE в тексте есть `AS "alias"` → `_renderReturning` рендерит `"u"."id" AS "id"`; у INSERT нет FROM, поэтому `renderReturningClause` (публичный, им же пользуется batch-путь `createMany` без полного sqb) рендерит `"id" AS "id"`. Квалифицированный INSERT-RETURNING даёт PG `42P01`
- **`COALESCE(json_agg(subq), '[]'::json)`** — empty array for one-to-many
- **Window functions** — `_renderWindow` renders `FUNC(field, $N…) OVER (PARTITION BY … ORDER BY … ROWS BETWEEN …)`, args → `values.push`; rank-family requires ORDER BY (enforced at render)
- **DML expression values** — a `sql`-fragment *value* in update/create/createMany/`onConflict().set()` renders via `renderValueCell`: duck-typed `isSqlValueFragment` (`kind:'sql-value'`) → `shiftParameters` local `$1..$N` onto the current `paramIndex`, concatenate `values`, shift+dedup `slotOrder`; anything else → `$${paramIndex.p++}` param. `renderConflictClause(keys, conflictTarget, doNothing, setMap, values, paramIndex)` — `doNothing` wins; default SET is `EXCLUDED."k"` for every non-target key, or the explicit `setMap` (F, `204e91d`)
- **JOIN ON** — `_renderJoinOn` dispatcher for `WhereExpression`: plain `WhereCondition` → `_buildConditionSql`; `WhereGroup` → `_buildWhereGroupSql` (parens when `hasSiblings`); `WhereFragment` → `_renderWhereFragment` (P1 + `$N` shift). A group/fragment on a fully-joined edge (self-join) is pushed to the WHERE extras parenthesized — never silently dropped (C, `34ed318`)
- **GROUP BY** — `ReadonlySqb.groupBy` is `GroupByStep[]`: `group-by-column` renders `"alias"."col"` (step `tableAlias` or `mainTableAlias` fallback), `group-by-fragment` renders through `_renderGroupByFragmentStep` (local `$1..$N` shifted onto `paramIndex`, values/slotOrder pushed, mirror of the ORDER BY fragment step). Window validation matches group columns by name **and** alias (empty `tableAlias` = legacy fallback) (C, `34ed318`)

## Include System

Includes are rendered as `LEFT JOIN LATERAL` with JSON aggregation:
- **one-to-one** / **many-to-one**: `row_to_json(subq)` → single JSON object
- **one-to-many**: `COALESCE(json_agg(subq), '[]'::json)` → JSON array
- **Nested includes**: recursive `_buildInclude()` calls

After query execution, `unpackIncludes()` strips `prop.` prefixes from JSON keys.

## Result Reshaping

For multi-table SELECT queries, `ResultReshaper.reshape()` transforms flat PG rows:
```
{ "u.id": 1, "u.name": "Alice", "p.title": "Post" }
→ { u: { id: 1, name: "Alice" }, p: { title: "Post" } }
```

**Вложенность обязательна для всех multi-запросов** — включая one-алиасные (`query({ u })`), с `isMulti`-флагом из контракта:

- **Дискриминатор** — `sqb.isMulti === true || sqb.tableContext.size > 1`. Single-запросы никогда не вкладываются: их селекты с `tableAlias` (single тоже ставит алиас на селекты) падают на корень как есть.
- **Гейт в `sql-generator.ts`** — `isMultiTable` решает, алиасить ли колонки префиксом (`"u"."name" AS "u.name"`) и строить ли составные ключи для внутреннего SQL.
- **Гейт в `helpers.ts` (`finalizeRows`)** — reshape применяется только при `operation === 'select' && (isMulti || size > 1) && selects?.length > 0`. Иначе — строки как есть (`unpackIncludes` делается всегда).
- Дизъюнкция с `size > 1` сохраняет обратную совместимость: вручную собранный `ReadonlySqb` с несколькими таблицами (внешние адаптеры, unit-тесты) ведёт себя как multi и без явного флага; для one-алиасного multi флаг обязателен (кладет его `MultiQueryBuilder` в core).

## Global Side Effects

**Нет.** Импорт пакета не мутирует глобальное состояние `pg`.

Парсеры типов задаются **на пул**, а не через `pgTypes.setTypeParser` —
`createKadmiumTypes()` в `index.ts:42-58` возвращает объект, который отдаёт
`int8` → `Number` и `date` → строку `'YYYY-MM-DD'`, а для остальных oid
делегирует глобальным. Прежний глобальный `setTypeParser(20, …)` удалён.

⚠️ `int8` всё ещё приводится к `number`: значения выше 2^53 теряют точность
(`Number()`), для больших внешних идентификаторов нужен uuid/строковый PK.
См. `plans/data-types.md` — B4/R2.

## Referential Integrity

`expectedForeignKeys()` (`diff/types.ts`) превращает IR в список ожидаемых FK: поле с `ref` и без `sourceModel` — это FK, владеющий колонкой. Действия приходят из model DSL уже в канонической uppercase-форме (`onDelete`/`onUpdate` на `IrField`), маппинг lowercase → uppercase живёт в core.

- **CREATE** — `ddl-sql.ts` рендерит `ON DELETE ... ON UPDATE ...` в `ADD CONSTRAINT`; отсутствие действия даёт `NO ACTION`.
- **ALTER** — смена действия порождает `AlterForeignKeyOp` (`{ oldFk, newFk }`), а `apply.ts` разворачивает его в `DROP CONSTRAINT` → `ADD CONSTRAINT`. Отдельного «изменения действия» в PG нет, поэтому это всегда пара операций.
- **Валидация** — `assertReferentialAction()` (`ddl-validate.ts`) проверяет и `op.fk`, и `op.oldFk`/`op.newFk` у ALTER. Значение приходит из IR, а не от пользователя, но проверка всё равно нужна: в `ON DELETE` нельзя подставить произвольный SQL.

Тесты: `test/diff/types.test.ts` (форма `expectedForeignKeys`), `test/diff/compute.test.ts` (порождение alter-операции), `test/diff/apply.test.ts` + `test/diff/render.test.ts` (DROP/ADD и текст превью), `test-project/test/ddl-fk.test.ts` (реальный PostgreSQL: `information_schema`, смена действия на существующем FK, `checkHealth`).
## Indexes and Uniqueness

Уникальность в этой схеме выражается **только индексом**. `expectedIndexes()` (`diff/types.ts`) строит `idx_<table>_<field>`; оторвать `.unique()` от колоночного `UNIQUE` нельзя — иначе PostgreSQL создаст ещё и собственный `table_col_key`, который `computeDiff()` отфильтровывает как системный, то есть неотслеживаемый мусор рядом с нашим индексом.

- **Один источник правды для превью** — `createTableColumns()` (`diff/types.ts`) вырезает инлайн `UNIQUE` у колонок, которым достаётся отдельный `add-index`. Его зовут и `apply.ts` (фаза 1), и `render.ts` (ветка `create-table`). Дублировать эту логику в одном из них нельзя: `db:sql` начнёт показывать DDL, отличный от того, что сделает `db:migrate`.
- **Сверка по имени и по `isUnique`** — `computeDiff()` ищет существующий индекс по имени (`Map` от `DbIndex`, а не `Set` имён) и сверяет уникальность. Имя у `.unique()`-поля и у обычного `f.index` одно, поэтому сверка только по имени молча пропускала оба перехода — поставить и снять `.unique()` на существующем индексе.
- **Пересоздание, а не «изменение»** — отдельной операции «сменить уникальность» в PG нет, поэтому расхождение разворачивается в `drop-index` → `add-index`. Порядок обязателен: `apply.ts` выполняет операции в порядке массива, и `add-index` перед `drop-index` упрётся в уже существующий индекс.
- **Индекс с `isUnique: true` на данных с дублями** упадёт с PG `23505`. Это намеренно: миграция должна сообщить о конфликте, а не молча оставить схему неуникальной.

Тесты: `test/diff/compute.test.ts` (пересоздание индекса в обе стороны и отсутствие операций при совпадении), `test/diff/render.test.ts` (нет инлайн `UNIQUE` у индексированной колонки, но он есть у колонки без индекса), `test/diff/apply.test.ts` (порядок фаз), `test-project/test/ddl-one-to-one.test.ts` (реальный PostgreSQL: уникальный индекс от `.oneToOne()`, вставка дубля → `23505`).

## Rules

- **All SQL generation** goes through `SqlGenerator` — never build SQL strings directly
- **Parameterized queries only** — never interpolate user values into SQL
- **Includes use LEFT JOIN LATERAL** — not correlated subqueries (not N+1)
- **One INSERT renderer**: `renderInsert()` in `sql-generator.ts` is the only place that builds `INSERT ... VALUES ... ON CONFLICT ... RETURNING`. Both `_buildUpsertQuery` and the three `build*Sql` helpers in `helpers.ts` delegate to it — don't reassemble that string in a new call site
- **Test against real Postgres**: `cd test-project && npm run db:up && npm run test:project`

## When Changing `sql-generator.ts`

- `json_agg`, `row_to_json` are PostgreSQL-specific — don't abstract to sql-types
- `_buildInclude()` is recursive — nested includes call it again
- `_renderValue()` handles: primitives, arrays (IN/BETWEEN), null, field-to-field refs
- `_buildJoinGraph()` + `_findJoinIslands()` — BFS for multi-join FROM clause ordering

## Related Packages

- `packages/sql-types` — interface contract (ReadonlySqb, SqlAdapter)
- `packages/core` — builds AST (KadmiumSqb), consumes SqlAdapter
