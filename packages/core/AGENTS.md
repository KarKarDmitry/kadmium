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

**`Model`** — base class with static registry.

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

**`compileModel(model)`** → `ModelIR` — compiles once, cached in OrmManager.

## Layer 3: ORM (`orm/`)

### Query Builders

| Builder | Usage | Returns |
|---------|-------|---------|
| `SingleQueryBuilder` | `orm.single(User)` | One table queries |
| `MultiQueryBuilder` | `orm.query({ u: User, p: Post })` | Multi-table queries |
| `Relation` | `.include(t => [t.author])` | Include relations |

### Proxy System

Runtime `Proxy` objects provide type-safe field access:

- **`FilterProxy<T>`** — `t.name.eq('Alice')`, `t.age.gt(18)`
- **`SelectProxy<T>`** — `t => [t.name, t.email]`
- **`RelationProxy<T>`** — `t => [t.author, t.posts]`
- **`OrderProxy<T>`** — `t => t.createdAt`

### AST (`ast/`)

- **`WhereCondition`** — `{ alias, field, column, op, value }`
- **`WhereGroup`** — `{ op: 'AND'|'OR', conditions: [...] }`
- **`SelectableField`** — SELECT field with phantom types
- **`AggregateField`** — COUNT/SUM/AVG/MIN/MAX

### SQB (`sqb.ts`)

**`KadmiumSqb`** — mutable AST accumulator, snapshot/state source for builders.

### Builder Reuse (`clone()`)

Terminals (`go`, `toSql`, `count`, `exists`, `update`, `delete`, `create`, `createMany`, multi `select`) operate on a **snapshot clone**, so calling them never mutates the builder. To branch a configured builder into multiple queries, use `.clone()`:

```typescript
const base = app.orm.single(User).where(t => t.name.eq('Alice'));
const page = await base.clone().page(2, 10).go(); // base untouched
```

`clone()` copies the sqb and shares ir/adapter. Aggregate selects are deep-copied (AggregateField.as() mutates alias). Configuration calls (`.where`, `.limit`, `.order`) still mutate the builder in place by design — use `.clone()` when you want to keep the original untouched.

### Include System

Includes are implemented as `LEFT JOIN LATERAL` with JSON aggregation (in the adapter).

```typescript
orm.single(User)
  .include(t => [
    t.posts.where(p => p.published.eq(true)).order(p => [p.createdAt.desc]),
    t.author,  // many-to-one
  ])
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
