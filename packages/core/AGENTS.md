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
  name = f.string;
  email = f.string.unique;
  posts = f.ref.target(Post, 'posts');
}
Model.register(User, Post);
```

Key methods:
- `$build()` → `ModelSchema` (field definitions + metadata)
- `$relations()` → forward relations (User → Post)
- `$refs()` → inverse relations (Post → User via refs)
- `Model.resolve(name)` → find class by name from registry

**Field builders** (`model/fields/`): `f.string`, `f.number`, `f.boolean`, `f.pk`, `f.pk.uuid`, `f.ref.target(model, inverseName)`

### Primary key contract

**PK is identified by `FieldIR.isPrimary` — never by the name `id`.**

- `Model` declares no `id` field. `$build()` injects a default PK **first**, and only if the
  subclass declared neither a PK nor an `id` key. So `uid = f.pk.uuid` in a subclass displaces
  the default, while an explicit non-PK `id = f.string` is respected and leaves the model
  without a PK. Cost: `new User().id` no longer exists — `id` is config, not data.
- Exactly one PK. `compileModel()` throws naming the offending fields on more than one.
  Composite PKs are unsupported.
- PK builders support `.alias()`. The column resolves as `field.alias ?? propertyName`, so
  `uid = f.pk.uuid.alias('session_uid')` is property `uid` on column `session_uid`.
- Codegen emits a `['~pk']` phantom holding the **property** name (never the alias), and
  `findById()` types its argument as `PkShape<M>` from it. Projects without codegen fall back
  to `~shape['id']`.
- Relation JOINs take the PK column from IR: `childField` renders under the included model's
  alias, `parentField` under the base model's — each side's PK comes from its own IR. A
  hardcoded `'id'` there gave PG `42P01`/`42703` on any custom PK.

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
| `MultiQueryBuilder` | `orm.query({ u: User, p: Post })` | Multi-table queries |
| `Relation` | `.include({ author: true })` | Include relations |

> **Note:** The new explicit CRUD surface (`plans/crud-api.md`) gives each
> operation its own entry and its own file: `orm.select()` (PR1, `select()` →
> `fields()`, structural `include()`), `orm.update()` (PR2, `set()` → `where()`
> → `returning()`), `orm.delete()` (PR3, `where()` → `returning()`),
> `orm.insert()` (PR4, `values()` → `onConflict()` → `returning()`) и
> `orm.insertMany()` (PR5, тот же набор шагов + `transaction(bool)`).
> `orm.single()` was **removed** in `0.2.0` (with `SingleQueryBuilder`
> and `orm/builders/handles.ts`). Every step lives on exactly one builder now.

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

Terminals (`go`, `first`, `count`, `exists`, `update`, `delete`, `insert`, `insertMany`, multi `fields`) operate on a **snapshot clone**, so calling them never mutates the builder. To branch a configured builder into multiple queries, use `.clone()`:

```typescript
const base = app.orm.select(User).where(t => t.name.eq('Alice'));
const page = await base.clone().page(2, 10).go(); // base untouched
```

`toSql()` (and `count().sql()` / `exists().sql()`) are `@deprecated` — debug-only; use `.compile()` (below), its SQL preview is `.compile().text`.

`clone()` copies the sqb and shares ir/adapter. Aggregate selects are deep-copied (AggregateField.as() mutates alias). Configuration calls (`.where`, `.limit`, `.order`) still mutate the builder in place by design — use `.clone()` when you want to keep the original untouched.

### Compiled Queries (`compile()` / `QuerySlots`)

`compile()` renders SQL **once**; the hot loop only substitutes slot values via `orm.run(c).fill({...}).go()` (zero proxy, zero clone, zero render). Available on `select().compile<T>()`/`compile(S)` and on the multi terminal `query({...}).fields(...).compile<T>()`/`compile(S)`. `CompiledQuery.single` marks first()-style unwrap for single; multi is always `single: false`.

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
- **Dynamic identifiers**: runtime column/table names are only expressible via `ident(name)` → `IdentMarker` (`{ kind: 'ident', name }`) — validated at construction (Postgres unquoted identifier: `^[A-Za-z_][A-Za-z0-9_]*$`, length 1–63) and rendered quoted (`"name"`) inline in the fragment text. It is **never** a parameter and never raw string interpolation; a string in the `sql` tag is always a parameter. Qualified names use composition `${ident('t')}.${ident('c')}` — dotted input (`ident('t.c')`) throws (G, `597622d`; see `test-project/test/orm/compiled/ident.test.ts`).
- **join().on и groupBy фрагменты**: `multi.join()` принимает `on` как `(tables) => WhereExpression | SqlFragment` — фрагмент нормализуется через `toSqlCondition` (P1-скобки и сдвиг `$N` на рендере как в WHERE; слоты в on-фрагменте делят paramIndex/slotOrder адаптера). `groupBy()` (select/multi) принимает `SelectableField | SqlFragment`: контракт `ReadonlySqb.groupBy` — шаги `GroupByColumnStep {kind, tableAlias?, column} | GroupByFragmentStep {kind, text, values, slotOrder}` (зеркало `OrderStep`); колонка пишет реальный `tableAlias` (fallback `mainTableAlias` — manual sqb), фрагмент прекомпилируется в `SqlGroupBy`. Лабиринт: группировка по полю не-главной таблицы рендерит её алиас (`GROUP BY "p"."author"`), а не main (`34ed318`; см. `test-project/test/orm/multi/fragments.test.ts`).
- **Referential actions**: `f.ref.target(M).onDelete(action)` / `.onUpdate(action)` задают поведение FK — `'no action' | 'cascade' | 'set null' | 'restrict' | 'set default'` (строго lowercase на входе; отсутствие шага = `NO ACTION`, т.е. дефолт БД). Принимает **только owning**-вариант `ref.target(...)`: у inverse-полей (`f.ref(M, 'comments')`) FK не существует, поэтому `.onDelete()` там недоступен на типах. Действие попадает в IR на поле, у которого `ref` задан и `sourceModel` пуст — ровно то же условие, по которому миграции строят ограничения (`compile.ts`). `set null` требует nullable-поля: `.onDelete('set null').notNull()` бросает на `$build()`, и **порядок вызовов не важен** — проверка итоговая. В IR хранится каноническая uppercase-форма (`ReferentialAction` в `sql-types`), в DSL-типе — lowercase-`ReferentialActionInput`: типы разные намеренно, чтобы lowercase нельзя было положить в IR напрямую. Смена действия на существующей колонке — обычная миграция (`AlterForeignKeyOp`: `DROP CONSTRAINT` → `ADD CONSTRAINT`), отдельной логики в рантайме нет.- **DML composition**: `values()`/`set()` принимают **объект** (коллбэк у `values()` удалён в `0.2.0`; у `onConflict().set()` он остался). Типы берутся из сгенерированного `~shape`: `InsertValuesData<TModel>` для VALUES, `SetData<TModel>` для SET — ключ проверяется по алias'у модели, значение принимает `V | SqlFragment`, `null` разрешён только nullable-полям, поля с `~defaults` можно опускать. Escape hatch — `valuesRaw()/setRaw()`. Keys map prop→alias; a `sql`-fragment **value** is precompiled to an opaque `SqlValue` (`kind:'sql-value'`, primary `toSqlValue`) — never interleaved as raw text. `set()` requires `onConflict()` first (runtime guard); `doNothing()` wins over `set` at render. Fragment identifiers must be quoted literals, proxy refs, or `ident()` (G); `slot()` inside DML fragments throws. Params in arithmetic need explicit casts (PG 42725) — see `test-project/test/orm/{insert,update}/fragments.test.ts` (F, `204e91d`).
- **DML guards** (`orm/guards.ts`): sql-pg рендерит UPDATE/DELETE/INSERT только из данных и wheres, поэтому `limit/offset/order/cursor/groupBy` в DML и `wheres` в INSERT **отбрасываются молча** (`.limit(1).delete()` удалил бы все строки). Гарды (`assertDmlUpdate`/`assertDmlInsert` + по-шаговые `*NoLimit/*NoOrder/*NoGroupBy`, `assertSelectAliasKnown`, `assertNoDuplicateJoin`) бросают в точке, где операция объявляется, а не в терминале — тогда ошибка указывает на строку сборки и не всплывает в горячем цикле `orm.run().fill().go()`. Структура: приватные O(1)-предикаты по одному полю + публичные функции «операция + шаг»; текст ошибки строится только в ветке throw. `where` **не требуется** для update/delete — это продуктовое решение. `assertSelectAliasKnown` ловит опечатку в алиасе селекта (multi-прокси отдаёт поле с `column=undefined`, и ошибка прилетала бы из PG 42P01); агрегаты и `sql`-фрагменты без `tableAlias` пропускаются. `assertNoDuplicateJoin` (C11, `995e0d5`) бросает на повторном `multi.join()` той же пары (left, right, direction) — раньше дубль пропускался молча, и второй `on` исчезал вместе с условием; другое направление разрешено. Тесты: `packages/core/test/orm/guards.test.ts` (модульные, чистый AST без БД) и `test-project/test/orm/multi/guards.test.ts` (сквозной путь через Postgres: что гард ловит ДО похода в базу и данные остаются нетронутыми).
- **`returning()` на insert/insertMany** (`orm/builders/upsert-helpers.ts`): финализаторы `CreateFinalizer`/`CreateManyFinalizer` получили `returning(fn)` — проекция RETURNING для вставки. Одиночный `create()` идёт через `operation='upsert'` → `adapter.execute(sqb)`, поэтому проекция кладётся в `sqb.selects` тем же путём, что у UPDATE/DELETE. Батч идёт через отдельный `adapter.createMany()`, минуя `execute` — там селекты передаются в опции `returning: SelectItem[]`, а SQL собирается в raw helpers sql-pg. Ключ результата — `sel.alias ?? sel.fieldName`; строка без строки результата (`doNothing` на конфликте) даёт `{}` для `create` и пустой массив для батча. Колонки RETURNING у INSERT рендерятся **без** квалификации алиасом — у INSERT нет FROM, `"u"."id"` даёт PG `42P01` (см. `packages/sql-pg/AGENTS.md`). Пустой `createMany([])` отдаёт finalizer-заглушку с `returning` → `go(): []`. Тесты: `test-project/test/orm/{insert,update,delete}/returning.test.ts` (одиночный/батч/upsert, alias, регрессия полной строки) + `packages/sql-pg/test/create-helpers.test.ts` (нумерация `$N` в RETURNING).
- **Explicit CRUD API: `orm.select(Model)`** (`orm/builders/select.ts`, PR1 из `plans/crud-api.md`): единственная read-only поверхность. Переименования против `single()`: `select()` → **`fields()`** (проекция), `include(t => [t.posts])` → **`include({ posts: ... })`** (структурный объект, связь по КЛЮЧУ: `true | { alias?, select?, where?, order?, limit?, include? }` — эта форма уже была и в `single()`, PR6 плана закрылся без кода). DML-методов (`update`/`delete`/`create`/`createMany`) на типе НЕТ — это ловит компилятор, а не рантайм. Наследует `BaseQueryBuilder` (где живут `where/and/or/groupBy/order/limit/offset`); `page()`/`cursor()`/`having`/`first()`/`count`/`exists`/`compile` определены в самом билдере. Неочевидности: **`fields()` обязан идти ДО `having()`** — алиасы агрегатов берутся из текущего `sqb.selects`, иначе `h.<alias>` неизвестен; **`first()` возвращает билдер**, а не строку (`first().go()`), при этом переносит режим терминала через параметр `Mo` в `SelectHandle` — `go()`/`compile()` типизируются как `Row | undefined`; **`fields()` без аргумента** восстанавливает проекцию «все поля»; `count` игнорирует `limit/offset` (S2), `exists` — `offset` (S3). Смысл `select()` не сужен — он рендерится как `RETURNING`. Тесты: `test-project/test/orm/select/api.test.ts` (31 функциональный тест, включая `@ts-expect-error`-ассерты на отсутствие DML).
- **Explicit CRUD API: `orm.update(Model)`** (`orm/builders/update.ts`, PR2): цепочка `set(data)` → `where(fn)` → `returning(fn)` → `go()`/`sql()`. `set` **обязателен** (иначе sync-throw `requires set(data)` — ошибка сборки ловится в точке вызова, как гарды), `where` **нет**: UPDATE без фильтра меняет все строки. `UpdateQueryBuilder` намеренно **НЕ наследует `BaseQueryBuilder`** — иначе пришлось бы сузить на типах `order/limit/offset/cursor/groupBy/include/first` ; разрешённые шаги перечислены явно, поэтому `.limit(1).update()` нельзя даже собрать, а `assertDmlUpdate` в `set()` остаётся defense-in-depth для JS. Общего DML-родителя у update/delete нет — `delete.ts` объявляет своё независимое сходство. **Тонкость**: `where()` пушит в `this.sqb`, а не в одноразовый клон `buildWriteFinalizer` — терминалы строятся из клона уже собранного sqb, иначе условие потерялось бы. `ReturningTerminal<S>` параметризован только проекцией (модель не нужна — результат описывается `S`). Тесты: `test-project/test/orm/update/api.test.ts` (13 тестов, включая `@ts-expect-error` на отсутствие select-шагов и на отсутствие DML у `select()`).
- **Explicit CRUD API: `orm.delete(Model)`** (`orm/builders/delete.ts`, PR3): цепочка `where(fn)` → `returning(fn)` → `go()`/`sql()`. `where` не обязателен (DELETE без фильтра удаляет все строки). `DeleteQueryBuilder` **не наследует `BaseQueryBuilder`** по той же причине, что и UPDATE. Отличие от UPDATE: **нет гарда** `assertDmlDelete` — повесить его некуда (у DELETE нет `set()`, где UPDATE его зовёт), а свежий sqb в конструкторе пуст и нерендерящиеся шаги в него попасть не могут. Общего DML-родителя с `UpdateQueryBuilder` нет: сходство ограничено `where/returning/go/sql`, переиспользуется лишь `buildWriteFinalizer`. Тип терминала назван `DeleteReturningTerminal`, а не `ReturningTerminal` — в одном модуле не нужен второй одинаково названный экспорт. Поведение при живых детях задаёт **`f.ref.target(...).onDelete(action)`**, а не сам delete-API — см. «Referential actions» ниже. Тесты: `test-project/test/orm/delete/api.test.ts` (18 тестов, включая `describe('referential integrity')` — реальное каскадирование/обнуление в PostgreSQL).
- **Explicit CRUD API: `orm.insert(Model)`** (`orm/builders/insert.ts`, PR4, `dd03566`): цепочка `values(data)` → `onConflict(fn)` → `set(data)`/`doNothing()` → `returning(fn)` → `go()`/`sql()`. Данные — **шаг, а не аргумент входа**: имена зеркалят клаузы SQL (`VALUES` и `SET`), а порядок цепочки читается как порядок клауз; так же сделан `update` (`set()`). `values` обязателен — sync-throw `requires values(data)`, ошибка ловится в точке вызова, как гарды. `InsertBuilder` **не наследует `BaseQueryBuilder`**: база несёт `where/order/limit`, не рендерящиеся в INSERT; гард `assertDmlInsert` в `values()` остаётся defense-in-depth для JS. **Конфликтные шаги пишут в `this.sqb` напрямую**, а не в одноразовый клон `buildCreateFinalizer` — иначе `onConflict()` потерялся бы к моменту `go()`. Одиночная вставка идёт через `operation='upsert'` → `adapter.execute(sqb)`. **Ограничение VALUES**: коллбэк не может ссылаться на поля модели — VALUES описывает ещё не существующую строку, а рендер квалифицирует ссылку алиасом (`"User"."name"`), и у INSERT нет FROM → PG 42P01; то же ограничение, что у RETURNING у INSERT. Полезные фрагменты в VALUES — без полей (`now()`, `upper($1)`). Рефакторинг: общие `onConflict/doNothing/set` вынесены из двух финализаторов в `buildConflictSteps`. Тесты: `test-project/test/orm/insert/api.test.ts` (29 тестов).
- **Explicit CRUD API: `orm.insertMany(Model)`** (`orm/builders/insert-many.ts`, PR5, `8db8669`): те же шаги плюс `transaction(bool)`. `transaction` — **шаг, а не опция второго аргумента** (вся write-поверхность собирается шагами); дефолт `true`, как в legacy `createMany`, последний вызов побеждает. Транзакции нет у одиночного `insert()` — там она всегда одна. **`values([])` бросает sync-throw `requires at least one row`**, а не возвращает `[]`: legacy `createMany([])` отдавал пустой результат, и молчаливый no-op скрывал потерю данных (забытый фильтр, неверный source). Побочный эффект: `assertDmlInsert` в `values()` вызывается ДО проверки пустоты, поэтому `.limit(1).insertMany()` ловится гардом. Батч уходит в `adapter.createMany()` мимо sqb (в отличие от одиночного `insert()`), конфликтные шаги — те же, что в `insert()`, пишут в `this.sqb`. SQL-превью батча помечается `-- preview: first of N rows`: рендерится только первая строка, и при N > 1 текст без маркера читался бы как одиночный INSERT. Тесты: `test-project/test/orm/insert/many.test.ts` (30 тестов).
- **`multi.ts` → `query.ts`, `select()` → `fields()`** (PR7): файл multi-переименован в `query.ts` (git распознал rename, 94% схожести), `MultiQueryBuilder.select()` → **`fields()`** — симметрия с `orm.select()`. Типы переименованы согласованно: `MultiSelectResult` → `MultiFieldsResult`, `MultiSelectProxy` → `MultiFieldsProxy` (`MultiQuerySlots.push` и `guards.ts` обновлены). Алиасов для старых имён не осталось — ломающее изменение публичного API, миграция в тестах разом (`test-project` уже вызывал `.fields()`).
- **`handles.ts` удалён в `0.2.0`** (исторически `7f91789`): `orm.single()` отдавал
  `DmlConfigHandle = SingleConfigHandle & SingleDml`, и DML-методы исчезали с типа на
  первом шаге, который sql-pg не рендерит в UPDATE/DELETE/INSERT
  (`order/cursor/limit/offset/page/first/findById/include`). Сужение существовало только
  из-за смешанной read/write поверхности. С раздельными билдерами оно не нужно: у
  `select()` вообще нет DML-методов, а `UpdateQueryBuilder`/`DeleteQueryBuilder`/
  `InsertBuilder` намеренно НЕ наследуют `BaseQueryBuilder` — `limit/order/groupBy/page/
  cursor` недоступны на типах, а не скрыты runtime-проверкой. Гарды
  (`assertDmlUpdateNoLimit/Order/GroupBy`, `assertDmlInsertNo*`) остались
  defense-in-depth для JS и динамики — вызываются из `set()`/`values()`.
  `assertDmlDeleteNo*` удалены вместе с ним: у DELETE нет гарда by design (повесить
  некуда — у DELETE нет `set()`, где UPDATE его зовёт).
- **Структура `test-project/test/orm/` — по операции**: файлы разложены по операции
  (`select/`, `insert/`, `update/`, `delete/`, `multi/`, `transaction/`, `compiled/`), а не
  по сценарию; один файл — один предмет, иначе его нельзя положить ни в одну папку.
  Площадка `legacy/` **удалена в `0.2.0`** вместе с `orm.single()`: она была единственным
  местом, где легаси-API встречался рядом с новым (`single.test.ts`,
  `guards-single.test.ts`, `clone-dml.test.ts`, `interop.test.ts`). Правило, которое за ней
  осталось: новый API проверяется только через
  `select/insert/insertMany/update/delete/query`, а `compiled/parity-select.test.ts` и
  `compiled/performance.test.ts` сверяют **два канала одного билдера** (`go()` против
  `run(compile()).fill().go()`) — не легаси с новым API. Гарды, применимые к новому API,
  лежат на своей площадке: `multi/guards.test.ts` (алиас таблицы, дубликат join — на
  `orm.query()`), `select/count-exists.test.ts` (S2/S3: `count()` игнорирует
  `limit/offset`, `exists()` — `offset`).