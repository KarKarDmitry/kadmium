# @karkardmitry/kadmium-sql-types

> Contract package — interfaces only, zero runtime logic.

## Purpose

Defines the **adapter contract** that all SQL backends must implement. Core and adapters depend on this package; no one implements here.

## Architecture

```
SqlAdapter (interface)
├── toSql(sqb) → { text, values }    — AST → parameterized SQL
├── execute(sqb) → rows              — run query
├── raw(sql, params) → rows          — raw SQL
├── create(collection, data) → row   — INSERT
├── beginTransaction() → TransactionalAdapter
├── ddl: DbDdlAdapter                — schema operations
└── end()?                           — close pool
```

## Key Types

- **`ReadonlySqb`** — immutable view of query builder state (operation, tableContext, wheres, selects, joins, includes, orders, limit, offset, groupBy, updateData)
- **`WhereCondition`** / **`WhereGroup`** — tree of SQL conditions
- **`SelectableField`** / **`AggregateSelectable`** — SELECT items
- **`IncludedRelation`** — include metadata for SQL generator
- **`JoinOptions`** — JOIN configuration
- **`DbDdlAdapter`** — DDL operations (inspect, create, alter, drop tables/columns/indexes/FK)
- **`TransactionalAdapter`** — extends SqlAdapter with commit/rollback/end

## Rules

- **No runtime code** — this package exports only TypeScript interfaces and types
- **No dependencies** — pure type definitions
- **Adapter-agnostic** — no PostgreSQL, MySQL, or any DB-specific types here
- **`{ text: string; values: unknown[] }`** is the universal parameterized query format — adapters convert to their driver's format
- **`WhereCondition.value`** can be a primitive, array (for IN/BETWEEN), or an object with `getIdentifierForSql()` for field-to-field comparisons

## Related Packages

- `packages/core` — reads these interfaces, builds AST (KadmiumSqb)
- `packages/sql-pg` — implements SqlAdapter for PostgreSQL

## Changes

When modifying this package:
- Every change affects ALL adapters — verify compatibility
- Prefer adding optional fields over changing existing ones (backward compat)
- Keep interfaces minimal — don't add adapter-specific concerns
