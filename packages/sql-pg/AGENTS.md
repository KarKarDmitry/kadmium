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
- **`RETURNING *`** — on UPDATE/DELETE
- **`COALESCE(json_agg(subq), '[]'::json)`** — empty array for one-to-many

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

## Global Side Effects

```typescript
pgTypes.setTypeParser(20, (val) => val === null ? null : Number(val));
```
Converts PostgreSQL `int8` (bigint) to JavaScript `number`. **Warning**: global mutation — conflicts with other pg users.

## Rules

- **All SQL generation** goes through `SqlGenerator` — never build SQL strings directly
- **Parameterized queries only** — never interpolate user values into SQL
- **Includes use LEFT JOIN LATERAL** — not correlated subqueries (not N+1)
- **`RETURNING *`** on all UPDATE/DELETE operations
- **Test against real Postgres**: `cd test-project && npm run db:up && npm run test:project`

## When Changing `sql-generator.ts`

- `json_agg`, `row_to_json` are PostgreSQL-specific — don't abstract to sql-types
- `_buildInclude()` is recursive — nested includes call it again
- `_renderValue()` handles: primitives, arrays (IN/BETWEEN), null, field-to-field refs
- `_buildJoinGraph()` + `_findJoinIslands()` — BFS for multi-join FROM clause ordering

## Related Packages

- `packages/sql-types` — interface contract (ReadonlySqb, SqlAdapter)
- `packages/core` — builds AST (KadmiumSqb), consumes SqlAdapter
