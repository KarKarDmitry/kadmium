# @karkardmitry/kadmium-core

> ORM core: Model DSL, IR compilation, Query Builders, CLI, Codegen.

## Architecture (4 layers)

```
Model (DSL)  →  IR (contract)  →  ORM (AST + proxies)  →  SqlAdapter (exec)
```

Each layer reads only the layer above it. No circular dependencies.

## Directory Map

```
src/
├── model/          — Model class, field builders (f.string, f.ref, f.pk...)
├── ir/             — Intermediate Representation (ModelIR, FieldIR)
├── orm/            — Query builders, filters, includes, proxies
├── core/           — AppCore, config, model registry
├── cli/            — CLI commands (db, generate, init, format)
├── codegen/        — TypeScript code generation from models
└── index.ts        — Public exports
```

## Layer 1: Model (`model/`)

**`Model`** — base class with **process-global static registry** (`Model.register/Model.resolve/Model.clear`). This is shared mutable state: registering models affects the whole process. Tests and HMR must call `Model.clear()`; multi-tenant/schema-isolation requires per-process isolation or a scoped registry. Never rely on registration order.

```typescript
class User extends Model {
  id = f.pk;
  name = f.string;
  email = f.string.unique;
  posts = f.ref('Post', 'one-to-many');
}
Model.register(User, Post);
```

Key methods:
- `$build()` → `ModelSchema` (field definitions + metadata)
- `$relations()` → forward relations (User → Post)
- `$refs()` → inverse relations (Post → User via refs)
- `Model.resolve(name)` → find class by name from registry

**Field builders** (`model/fields/`): `f.string`, `f.number`, `f.boolean`, `f.pk`, `f.pk.uuid`, `f.ref(model, relation)`

## Layer 2: IR (`ir/`)

**Intermediate Representation** — the only contract between layers.

```typescript
interface ModelIR {
  name: string;           // Class name
  collection: string;     // snake_case table name
  fields: Record<string, FieldIR>;
}

interface FieldIR {
  type: FieldType;        // 'string' | 'number' | 'boolean' | 'ref' | 'primary' | ...
  alias: string;          // DB column name
  nullable: boolean;
  unique: boolean;
  isPrimary?: boolean;
  ref?: string;           // Target model name (for ref fields)
  foreignKey?: string;    // FK column name
  sourceModel?: string;   // For inverse relations
}
```

**`compileModel(model)`** → `ModelIR` — lives in `model/compile.ts` (the `Model → IR` arrow). It is the **only** place allowed to depend on the concrete `Model` class. `ir/` itself never imports the model layer. IR is cached once at registration (`ModelRegistry`); on-demand fallback compiles live in `ModelRegistry.irByName/irByClass` (counted in `compileCount`). ORM (`orm/`) depends only on `ModelIR` — never on model classes or build steps.

## Layer 3: ORM (`orm/`)

### Query Builders

| Builder | Usage | Returns |
|---------|-------|---------|
| `SelectQueryBuilder` | `orm.select(User)` | Explicit SELECT API (read-only) |
| `UpdateQueryBuilder` | `orm.update(User)` | Explicit UPDATE API (DML) |
| `DeleteQueryBuilder` | `orm.delete(User)` | Explicit DELETE API (DML) |
| `InsertBuilder` | `orm.insert(User)` | Explicit INSERT API (single row) |
| `InsertManyBuilder` | `orm.insertMany(User)` | Explicit INSERT API (batch) |
| `SingleQueryBuilder` | `orm.single(User)` | Legacy single-table (read/write) |
| `MultiQueryBuilder` | `orm.query({ u: User, p: Post })` | Multi-table queries |
| `Relation` | `.include({ author: true })` | Include relations |

> **Note:** The new explicit CRUD surface (`plans/crud-api.md`) gives each
> operation its own entry and its own file: `orm.select()` (PR1, `select()` →
> `fields()`, structural `include()`), `orm.update()` (PR2, `set()` → `where()`
> → `returning()`), `orm.delete()` (PR3, `where()` → `returning()`),
> `orm.insert()` (PR4, `values()` → `onConflict()` → `returning()`) и
> `orm.insertMany()` (PR5, тот же набор шагов + `transaction(bool)`).
> `orm.single()` is now `@deprecated`.

### Proxy System

Runtime `Proxy` objects provide type-safe field access:

- **`FilterProxy<T>`** — `t.name.eq('Alice')`, `t.age.gt(18)`
- **`SelectProxy<T>`** — `t => [t.name, t.email]`
- **`RelationProxy<T>`** — алиас `IncludeConfig<T>`: `{ author: true }`
- **`OrderProxy<T>`** — `t => t.createdAt`

### AST (`ast/`)

- **`WhereCondition`** — `{ alias, field, column, op, value }`
- **`WhereStep`** — `{ join: 'AND'|'OR', condition: Condition | Group }`
- **`WhereGroup`** — `{ elements: WhereStep[] }`; `WhereExpression = Condition | Group`
- **`SelectableField`** — SELECT field with phantom types; `.asc/.desc` → `OrderDirection`
- **`FuncField`** — base for aggregates/window functions; phantom `'~result'` for type inference
- **`AggregateField`** — COUNT/SUM/AVG/MIN/MAX; `.over()` → `WindowField`
- **`WindowField`** — `OVER (...)` functions; `.partitionBy/.orderBy/.rowsBetween`, `.validate()`

### SQB (`sqb.ts`)

**`KadmiumSqb`** — mutable AST accumulator, snapshot/state source for builders.

### Builder Reuse (`clone()`)

Terminals (`go`, `count`, `exists`, `update`, `delete`, `create`, `createMany`, multi `select`) operate on a **snapshot clone**, so calling them never mutates the builder. To branch a configured builder into multiple queries, use `.clone()`:

```typescript
const base = app.orm.single(User).where(t => t.name.eq('Alice'));
const page = await base.clone().page(2, 10).go(); // base untouched
```

`toSql()` (and `count().sql()` / `exists().sql()`) are `@deprecated` — debug-only; use `.compile()` (below), its SQL preview is `.compile().sql()`.

`clone()` copies the sqb and shares ir/adapter. Aggregate selects are deep-copied (AggregateField.as() mutates alias). Configuration calls (`.where`, `.limit`, `.order`) still mutate the builder in place by design — use `.clone()` when you want to keep the original untouched.

### Compiled Queries (`compile()` / `QuerySlots`)

`compile()` renders SQL **once**; the hot loop only substitutes slot values via `orm.run(c).fill({...}).go()` (zero proxy, zero clone, zero render). Available on `single().compile<T>()`/`compile(S)` and on the multi terminal `query({...}).fields(...).compile<T>()`/`compile(S)`. `CompiledQuery.single` marks first()-style unwrap for single; multi is always `single: false`.

```typescript
const S = new MultiQuerySlots({ u: User, p: Post }).push(t => [t.p.views]);
const c = app.orm.query({ u: User, p: Post })
  .join({ left: 'u', right: 'p', on: t => t.u.id.eq(t.p.author) })
  .where(t => t.p.views.gt(S.slot('views')))
  .fields(t => [t.u.name])
  .compile(S);
for (const req of incoming) await app.orm.run(c).fill({ views: req.min }).go();
```

- `QuerySlots(Model)` / `MultiQuerySlots({ alias: Model })` declare typed slots; `ToDef<S>` maps selectables → `{ name: valueType }`. `assertSlotNames` rejects slotOrder names not declared via `.slot()`.
- Typed slots need **non-null** `~shape` fields; nullable fields use the flat path: `slot('name')` + `compile<{ name: string | undefined }>()`.
- Multi slot names are global across aliases — disambiguate same-named columns with `.as('u_id')`.
- Slots in `include().where()` and `join().on` share the adapter's `paramIndex`/`slotOrder`.

### Include System

Includes are implemented as `LEFT JOIN LATERAL` with JSON aggregation (in the adapter).

```typescript
orm.select(User)
  .include({
    posts: { where: (p) => p.published.eq(true), order: (p) => [p.createdAt.desc] },
    author: true,  // many-to-one
  })
  .go();
// → { id: 1, name: "Alice", posts: [...], author: { id: 2, name: "Bob" } }
```

## Layer 4: SqlAdapter

Reads `KadmiumSqb` and generates SQL. Interface defined in `packages/sql-types`, implementation in `packages/sql-pg`.

```typescript
const adapter = new PgAdapter({ host, database, ... });
const orm = new OrmManager(appCore, adapter);
```

## AppCore (`core/`)

Application container with config, model registry, and module system.

- **`AppCore`** — holds config, IR cache, SQL adapter
- **`OrmManager`** — ORM facade bound to AppCore
- **Model Registry** — `Model.register(...)` for relation resolution

## CLI (`cli/`)

Commands: `db` (migrate), `generate` (codegen), `init` (project setup), `format` (prettier)

## Codegen (`codegen/`)

Generates TypeScript models from IR. Run via `kadmium generate`.

## Rules

- **IR is the contract** — never import model builders from ORM or vice versa
- **All SQL through SqlAdapter** — never build SQL strings in ORM
- **Proxy errors are runtime** — `Field "X" not found in Y` (no compile-time check)
- **Parameterized queries only** — no string interpolation
- **Integration tests** in `test-project/test/` — need Postgres (`npm run db:up`)
- **Tests required** for new behavior — this is an ORM, correctness matters
- **WHERE composition**: builder methods (`where/and/or/having/havingOr`) push flat steps — no scopes/auto-grouping, no `group()`/`groupAnd()`. Nested groups only via `and()/or()` expressions (re-exported at package root). SQL relies on PG precedence (AND > OR); explicit grouping = parentheses. **Opaque leaves**: `sql`-фрагменты принимаются в where/and/or/having/havingOr и выражениях `and()/or()` — precompiled to `SqlCondition` (`kind:'sql-condition'`) via `toSqlCondition()`; parens policy **P1** — fragment text wraps in `(...)` only when the immediate group has siblings (honoured in sql-pg `_renderWhereFragment`); slots shift with the shared `paramIndex` and dedup by name. `cursor()` excludes fragments (type-level `CursorWhereExpression`, no runtime guard) — it renders as a dedicated `sqb.cursor` WhereGroup: always parenthesized AND-member with the main where-group wrapped only when it contains OR steps; requires `order()` and conflicts with `offset()/page()` (see `plans/builder-expression.md`).
- **Dynamic identifiers**: runtime column/table names are only expressible via `ident(name)` → `IdentMarker` (`{ kind: 'ident', name }`) — validated at construction (Postgres unquoted identifier: `^[A-Za-z_][A-Za-z0-9_]*$`, length 1–63) and rendered quoted (`"name"`) inline in the fragment text. It is **never** a parameter and never raw string interpolation; a string in the `sql` tag is always a parameter. Qualified names use composition `${ident('t')}.${ident('c')}` — dotted input (`ident('t.c')`) throws (G, `597622d`; see `test-project/test/orm/ident.test.ts`).
- **join().on и groupBy фрагменты**: `multi.join()` принимает `on` как `(tables) => WhereExpression | SqlFragment` — фрагмент нормализуется через `toSqlCondition` (P1-скобки и сдвиг `$N` на рендере как в WHERE; слоты в on-фрагменте делят paramIndex/slotOrder адаптера). `groupBy()` (single/multi) принимает `SelectableField | SqlFragment`: контракт `ReadonlySqb.groupBy` — шаги `GroupByColumnStep {kind, tableAlias?, column} | GroupByFragmentStep {kind, text, values, slotOrder}` (зеркало `OrderStep`); колонка пишет реальный `tableAlias` (fallback `mainTableAlias` — manual sqb), фрагмент прекомпилируется в `SqlGroupBy`. Лабиринт: группировка по полю не-главной таблицы рендерит её алиас (`GROUP BY "p"."author"`), а не main (`34ed318`; см. `test-project/test/orm/fragment-embed.test.ts`).
- **DML composition**: `update()/create()/createMany()` and `onConflict().set()` accept `DmlData` — a values object **or** a callback with `FilterProxy` (`update((p) => ({ views: sql`${p.views} + 1` }))`). Keys map prop→alias; a `sql`-fragment **value** is precompiled to an opaque `SqlValue` (`kind:'sql-value'`, primary `toSqlValue`) — never interleaved as raw text. `set()` requires `onConflict()` first (runtime guard); `doNothing()` wins over `set` at render. Fragment identifiers must be quoted literals, proxy refs, or `ident()` (G); `slot()` inside DML fragments throws. Params in arithmetic need explicit casts (PG 42725) — see `test-project/test/orm/dml-fragment.test.ts` (F, `204e91d`).
- **DML guards** (`orm/guards.ts`): sql-pg рендерит UPDATE/DELETE/INSERT только из данных и wheres, поэтому `limit/offset/order/cursor/groupBy` в DML и `wheres` в INSERT **отбрасываются молча** (`.limit(1).delete()` удалил бы все строки). Гарды (`assertDmlUpdate/Delete/Insert`, `assertSelectAliasKnown`, `assertNoDuplicateJoin`) бросают в точке, где операция объявляется, а не в терминале — тогда ошибка указывает на строку сборки и не всплывает в горячем цикле `orm.run().fill().go()`. Структура: приватные O(1)-предикаты по одному полю + публичные функции «операция + шаг»; текст ошибки строится только в ветке throw. `where` **не требуется** для update/delete — это продуктовое решение. `assertSelectAliasKnown` ловит опечатку в алиасе селекта (multi-прокси отдаёт поле с `column=undefined`, и ошибка прилетала бы из PG 42P01); агрегаты и `sql`-фрагменты без `tableAlias` пропускаются. `assertNoDuplicateJoin` (C11, `995e0d5`) бросает на повторном `multi.join()` той же пары (left, right, direction) — раньше дубль пропускался молча, и второй `on` исчезал вместе с условием; другое направление разрешено. Тесты: `packages/core/test/orm/guards.test.ts` (модульные, чистый AST без БД) и `test-project/test/orm/guard.test.ts` (сквозной путь через Postgres: что гард ловит ДО похода в базу и данные остаются нетронутыми).
- **`returning()` на create/createMany** (`orm/builders/upsert-helpers.ts`): финализаторы `CreateFinalizer`/`CreateManyFinalizer` получили `returning(fn)` — проекция RETURNING для вставки. Одиночный `create()` идёт через `operation='upsert'` → `adapter.execute(sqb)`, поэтому проекция кладётся в `sqb.selects` тем же путём, что у UPDATE/DELETE. Батч идёт через отдельный `adapter.createMany()`, минуя `execute` — там селекты передаются в опции `returning: SelectItem[]`, а SQL собирается в raw helpers sql-pg. Ключ результата — `sel.alias ?? sel.fieldName`; строка без строки результата (`doNothing` на конфликте) даёт `{}` для `create` и пустой массив для батча. Колонки RETURNING у INSERT рендерятся **без** квалификации алиасом — у INSERT нет FROM, `"u"."id"` даёт PG `42P01` (см. `packages/sql-pg/AGENTS.md`). Пустой `createMany([])` отдаёт finalizer-заглушку с `returning` → `go(): []`. Тесты: `test-project/test/orm/returning.test.ts` (одиночный/батч/upsert, alias, регрессия полной строки) + `packages/sql-pg/test/create-helpers.test.ts` (нумерация `$N` в RETURNING).
- **Explicit CRUD API: `orm.select(Model)`** (`orm/builders/select.ts`, PR1 из `plans/crud-api.md`): новая read-only поверхность, отделённая от legacy `single()`. Переименования против `single()`: `select()` → **`fields()`** (проекция), `include(t => [t.posts])` → **`include({ posts: ... })`** (структурный объект, связь по КЛЮЧУ: `true | { alias?, select?, where?, order?, limit?, include? }` — эта форма уже была и в `single()`, PR6 плана закрылся без кода). DML-методов (`update`/`delete`/`create`/`createMany`) на типе НЕТ — это ловит компилятор, а не рантайм. Наследует `BaseQueryBuilder` (где живут `where/and/or/groupBy/order/limit/offset`); `page()`/`cursor()`/`having`/`first()`/`count`/`exists`/`compile` определены в самом билдере. Неочевидности: **`fields()` обязан идти ДО `having()`** — алиасы агрегатов берутся из текущего `sqb.selects`, иначе `h.<alias>` неизвестен; **`first()` возвращает билдер**, а не строку (`first().go()`), при этом переносит режим терминала через параметр `Mo` в `SelectHandle` — `go()`/`compile()` типизируются как `Row | undefined`; **`fields()` без аргумента** восстанавливает проекцию «все поля»; `count` игнорирует `limit/offset` (S2), `exists` — `offset` (S3). Legacy `SingleConfigHandle.select()` помечен `@deprecated`, но `SingleDml.select()` — **нет**: там селект рендерится как `RETURNING`. Тесты: `test-project/test/orm/select-api.test.ts` (31 функциональный тест, включая `@ts-expect-error`-ассерты на отсутствие DML).
- **Explicit CRUD API: `orm.update(Model)`** (`orm/builders/update.ts`, PR2): цепочка `set(data)` → `where(fn)` → `returning(fn)` → `go()`/`sql()`. `set` **обязателен** (иначе sync-throw `requires set(data)` — ошибка сборки ловится в точке вызова, как гарды), `where` **нет**: UPDATE без фильтра меняет все строки. `UpdateQueryBuilder` намеренно **НЕ наследует `BaseQueryBuilder`** — иначе пришлось бы сузить на типах `order/limit/offset/cursor/groupBy/include/first` (как в `handles.ts`); разрешённые шаги перечислены явно, поэтому `.limit(1).update()` нельзя даже собрать, а `assertDmlUpdate` в `set()` остаётся defense-in-depth для JS. Общего DML-родителя у update/delete нет — `delete.ts` объявляет своё независимое сходство. **Тонкость**: `where()` пушит в `this.sqb`, а не в одноразовый клон `buildWriteFinalizer` — терминалы строятся из клона уже собранного sqb, иначе условие потерялось бы. `ReturningTerminal<S>` параметризован только проекцией (модель не нужна — результат описывается `S`). Legacy `OrmManager.single()` и `SingleDml.update()` помечены `@deprecated`. Тесты: `test-project/test/orm/update-api.test.ts` (13 тестов, включая `@ts-expect-error` на отсутствие select-шагов и на отсутствие DML у `select()`).
- **Explicit CRUD API: `orm.delete(Model)`** (`orm/builders/delete.ts`, PR3): цепочка `where(fn)` → `returning(fn)` → `go()`/`sql()`. `where` не обязателен (DELETE без фильтра удаляет все строки). `DeleteQueryBuilder` **не наследует `BaseQueryBuilder`** по той же причине, что и UPDATE. Отличие от UPDATE: **нет гарда** `assertDmlDelete` — повесить его некуда (у DELETE нет `set()`, где UPDATE его зовёт), а свежий sqb в конструкторе пуст и нерендерящиеся шаги в него попасть не могут. Общего DML-родителя с `UpdateQueryBuilder` нет: сходство ограничено `where/returning/go/sql`, переиспользуется лишь `buildWriteFinalizer`. Тип терминала назван `DeleteReturningTerminal`, а не `ReturningTerminal` — в одном модуле не нужен второй одинаково названный экспорт. **Ограничение БД, не ORM**: FK всегда `ON DELETE NO ACTION` — в model DSL нет ни `onDelete()`, ни `cascade()` (`ReferenceFieldBuilder` их не имеет), а `expectedForeignKeys()` в sql-pg хардкодит действие. Удаление родителя при живых детях падает с FK-ошибкой; тесты чистят детей первыми (`clearDependents`), а `describe('referential integrity')` фиксирует саму границу. Каскад — отдельная фича DSL, не часть delete-API. Legacy `SingleDml.delete()` помечен `@deprecated`. Тесты: `test-project/test/orm/delete-api.test.ts` (15 тестов; `beforeEach` c `resetAndSeed`, т.к. тесты мутируют общие сиды и иначе зависят от порядка).
- **Explicit CRUD API: `orm.insert(Model)`** (`orm/builders/insert.ts`, PR4, `dd03566`): цепочка `values(data)` → `onConflict(fn)` → `set(data)`/`doNothing()` → `returning(fn)` → `go()`/`sql()`. Данные — **шаг, а не аргумент входа**: имена зеркалят клаузы SQL (`VALUES` и `SET`), а порядок цепочки читается как порядок клауз; так же сделан `update` (`set()`). `values` обязателен — sync-throw `requires values(data)`, ошибка ловится в точке вызова, как гарды. `InsertBuilder` **не наследует `BaseQueryBuilder`**: база несёт `where/order/limit`, не рендерящиеся в INSERT; гард `assertDmlInsert` в `values()` остаётся defense-in-depth для JS. **Конфликтные шаги пишут в `this.sqb` напрямую**, а не в одноразовый клон `buildCreateFinalizer` — иначе `onConflict()` потерялся бы к моменту `go()`. Одиночная вставка идёт через `operation='upsert'` → `adapter.execute(sqb)`. **Ограничение VALUES**: коллбэк не может ссылаться на поля модели — VALUES описывает ещё не существующую строку, а рендер квалифицирует ссылку алиасом (`"User"."name"`), и у INSERT нет FROM → PG 42P01; то же ограничение, что у RETURNING у INSERT. Полезные фрагменты в VALUES — без полей (`now()`, `upper($1)`). Рефакторинг: общие `onConflict/doNothing/set` вынесены из двух финализаторов в `buildConflictSteps`. Legacy `SingleDml.create()` помечен `@deprecated`. Тесты: `test-project/test/orm/insert-api.test.ts` (30 тестов).
- **Explicit CRUD API: `orm.insertMany(Model)`** (`orm/builders/insert-many.ts`, PR5, `8db8669`): те же шаги плюс `transaction(bool)`. `transaction` — **шаг, а не опция второго аргумента** (вся write-поверхность собирается шагами); дефолт `true`, как в legacy `createMany`, последний вызов побеждает. Транзакции нет у одиночного `insert()` — там она всегда одна. **`values([])` бросает sync-throw `requires at least one row`**, а не возвращает `[]`: legacy `createMany([])` отдавал пустой результат, и молчаливый no-op скрывал потерю данных (забытый фильтр, неверный source). Побочный эффект: `assertDmlInsert` в `values()` вызывается ДО проверки пустоты, поэтому `.limit(1).insertMany()` ловится гардом. Батч уходит в `adapter.createMany()` мимо sqb (в отличие от одиночного `insert()`), конфликтные шаги — те же, что в `insert()`, пишут в `this.sqb`. SQL-превью батча помечается `-- preview: first of N rows`: рендерится только первая строка, и при N > 1 текст без маркера читался бы как одиночный INSERT. Legacy `SingleDml.createMany()` помечен `@deprecated`. Тесты: `test-project/test/orm/insert-many-api.test.ts` (31 тест).
- **`multi.ts` → `query.ts`, `select()` → `fields()`** (PR7): файл multi-переименован в `query.ts` (git распознал rename, 94% схожести), `MultiQueryBuilder.select()` → **`fields()`** — симметрия с `orm.select()`. Типы переименованы согласованно: `MultiSelectResult` → `MultiFieldsResult`, `MultiSelectProxy` → `MultiFieldsProxy` (`MultiQuerySlots.push` и `guards.ts` обновлены). Алиасов для старых имён не осталось — ломающее изменение публичного API, миграция в тестах разом (`test-project` уже вызывал `.fields()`).
- **DML-сужение на типах** (`orm/builders/handles.ts`, `7f91789`): `orm.single()` отдаёт `DmlConfigHandle = SingleConfigHandle & SingleDml`, а не `SingleConfigHandle` напрямую. DML-методы живут в отдельном интерфейсе `SingleDml`, поэтому они **исчезают с типа** на первом шаге, который sql-pg не рендерит в UPDATE/DELETE/INSERT: `order()`, `cursor()`, `limit()`, `offset()`, `page()`, `first()` (ставит `limit=1`), `findById()` (= `where(pk).first()`), `include()`. `where()/and()/or()/clone()` DML **не** снимают — фильтр в DML нужен (основной сценарий `update({...}).where(...)`). `groupBy()` **не сужен** намеренно: объявлен как `groupBy(): this` в `SingleShared`, сужение сломало бы ветку для всех вызывающих — единственный не-сужённый кейс, его ловит `assertDmlUpdateNoGroupBy`. `select()` **не сужен**: `sqb.selects` рендерится как `RETURNING` (`_buildUpdateQuery`/`_buildDeleteQuery` в sql-pg), поэтому `select(t => [t.id]).update({...})` — валидный `UPDATE ... RETURNING "id"`. Ошибку ловит компилятор (`Property 'update' does not exist on type 'SingleOrderingBranch<...>'`) до запуска; гарды остаются defense-in-depth для JS и динамики. У `include()` гарда нет — там сужение единственный ловец. Техническая деталь: тип возврата `limit()` вынесен в параметр `L` у `SingleShared` — переопределить `limit(): this` потомком нельзя (TS2430, `this` инстанцируется подтипом, а `DmlConfigHandle` сам подтип `SingleConfigHandle`); через `L` каждая ветка объявляет результат явно. Тесты: `packages/core/test/orm/handles.test.ts` (парные ассерты `@ts-expect-error` + `toThrow` на гарде) и `test-project/test/orm/guard.test.ts` (сквозной путь + тест, что `select()` доходит до `RETURNING`).

## Verification

```bash
npm run check:type   # Type check
npm run lint         # ESLint
npm run format:check # Prettier
npm run test:project # Integration tests (requires docker db:up)
```

## Related Packages

- `packages/sql-types` — adapter interface contract
- `packages/sql-pg` — PostgreSQL adapter
