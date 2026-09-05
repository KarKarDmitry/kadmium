# Kadmium

> TypeScript ORM for PostgreSQL — monorepo.

## Quick Start

```bash
npm run check:type    # Type check all packages
npm run lint          # ESLint
npm run format:check  # Prettier
npm run build         # Build core
npm run test:project  # Integration tests (requires docker db:up)
```

## Packages

| Package | Purpose | AGENTS.md |
|---------|---------|-----------|
| `@karkardmitry/kadmium-sql-types` | Adapter interface contract | [sql-types/AGENTS.md](./sql-types/AGENTS.md) |
| `@karkardmitry/kadmium-sql-pg` | PostgreSQL adapter | [sql-pg/AGENTS.md](./sql-pg/AGENTS.md) |
| `@karkardmitry/kadmium-core` | ORM core: Model, IR, Query Builders, CLI | [core/AGENTS.md](./core/AGENTS.md) |

## Architecture

```
Model (DSL)  →  IR (contract)  →  ORM (AST + proxies)  →  SqlAdapter (exec)
```

- **Model** — user-facing DSL (`f.string`, `f.ref`, `f.pk`)
- **IR** — Intermediate Representation, compiled once, cached
- **ORM** — query builders with type-safe proxies
- **SqlAdapter** — interface in sql-types, implementation in sql-pg

## Dependency Graph

```
core → sql-types ← sql-pg
```

No circular dependencies. Core never imports sql-pg directly.

## Rules for Agents

- **IR is the contract** — never import model builders from ORM or vice versa
- **All SQL through SqlAdapter** — never build SQL strings in ORM layer
- **Parameterized queries only** — no string interpolation
- **Tests required** for new behavior — integration tests in `test-project/test/`
- **Keep PRs under ~300 lines** — split into separate commits/PRs
- **PK identified by `FieldIR.isPrimary`** — never by field name alone
