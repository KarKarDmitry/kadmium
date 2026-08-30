# Kadmium — Project Review & Agent Plan

> Honest multi-axis review (correctness, architecture, security, performance, readability)
> with a prioritized execution plan. Generated 2026-08-29.
> Updated 2026-08-29 — Phase 1 (correctness) + integration test harness completed.

## Repository snapshot

- **Monorepo** (npm workspaces): `packages/core` (ORM + CLI), `packages/sql-types` (interfaces), `packages/sql-pg` (PostgreSQL adapter).
- **Git**: initialized (`fd28a9f`). Root `.gitignore` present; `test-project/.env` is **untracked**.
- **Tests**: `test-project/test/` — integration harness against real Postgres (docker compose): `global-setup.ts` seeds via the ORM layer before vitest; 12 files / 69 tests pass. `npm run test:project` + `test-project` has `typecheck`.
- **help_source/**: gitignored legacy scaffolding; clean it up eventually.

## Verdict

Architecturally sound, well-decoupled IR contract, good CLI. Correctness layer (schema DDL + core query path) now verified against a live DB and substantially fixed; includes (incl. nested), `.default()`, `alias()`, bigint-id typing and IR caching all work; include models unified. **Still not production-ready**: no README, TS version mismatch.

---

## Five-axis findings

### 1️⃣ Correctness

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| C1 | 🔴 | Decimal/float silently truncated to integer | ✅ Fixed (pre-existing, in `fd28a9f`): `decimal\|float\|bigint\|numeric` in `FieldType`/`normalizeType`/`pgType`. |
| C2 | 🔴 | `diffToHealth` summary bug | ✅ Fixed (in `fd28a9f`): clear `tablesMissing`/`tablesExpected`/`tablesMatching`. |
| C3 | 🔴 | No meaningful tests / no typecheck on tests | ✅ Fixed (`a36dcea`): integration harness; `test/**/*` in tsconfig + `typecheck` script. |
| C4 | 🟠 | `findById` PK lookup | ✅ Fixed: locates PK via `isPrimary` (`035696a`); bigint id normalized to `number` at the adapter (D8). |
| C5 | 🟠 | `go()` silently returns `[]` without adapter | ✅ Fixed: single (in `fd28a9f`), multi (`5f217a4`). |
| C6 | 🟠 | bigint PK defaulted to integer / PK never emitted | ✅ Fixed (`ba16cbd`): PK detected via `FieldIR.isPrimary`, DDL emits `bigserial`. |
| D1 | 🔴 | **PK + serial never generated** → every insert failed (`id bigint NOT NULL UNIQUE`, no PK) | ✅ Fixed (`ba16cbd`). |
| D2 | 🔴 | **`f.bool`/`f.ref` compiled to `string`** → varchar columns, no FK constraints | ✅ Fixed (`ba16cbd`). |
| D3 | 🟠 | **Numeric/ref filters missing `.gt()`/`.eq()`** (`int`/`decimal`/`float`/`numeric`/`ref` → bare `BaseFilter`) | ✅ Fixed (`035696a`). |
| D4 | 🟠 | **`update`/`delete` broken**: `missing FROM-clause`, delete had no `RETURNING *` | ✅ Fixed (`035696a`). |
| D5 | 🟠 | **Includes returned only `{alias.id}`** (not the related object) | ✅ Fixed (`035696a` + `6e7d915`): to-one/to-many and **nested** (`author.posts`) all render clean. |
| D6 | 🟠 | **`.default()` silently ignored in DDL** — builders write `spec.default`, `irToColumns` hardcodes `defaultValue: null` | ✅ Fixed (`78cff3b`): `renderDefault()` renders a strict per-type SQL literal; `IntegerFieldBuilder` rejects non-integer defaults. |
| D7 | 🟡 | **`alias()` doesn't rename the DB column** — `irToColumns` uses the field name | ✅ Fixed: column/property split threaded through WHERE/SELECT/ORDER/GROUP BY/UPDATE/create + result mapping; `alias.test.ts` covers DDL, select, filter, update, order. |
| D8 | 🟡 | **bigint id: type `number` vs runtime `string`** (node-pg) | ✅ Fixed: adapter parses `int8` → `number`. ⚠️ Precision limit 2^53 — use `f.pk.string`/`f.pk.uuid` for large ids. |

### 2️⃣ Architecture

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| A1 | 🟠 | Dead SQL renderers `single.ts:469-513` (`_renderIncludes`/`_formatGroup`/`_isCondition`) | ✅ Resolved (already removed — stale finding) |
| A2 | 🟠 | Two incompatible include mental models (`RelationBuilder` vs `IncludedRelation`) | ✅ Fixed: single `Relation` class (DSL + runtime + phantom types); `resolveInclude` and ToOne/ToMany subclasses removed; `IncludedRelation` is its adapter-facing projection. |
| A3 | 🟠 | `toSql()` requires a live adapter | ⬜ By design |
| A4 | 🟡 | Type layer is ~60% of ORM code | ⬜ Pending (TODO 4.1) |
| A5 | 🟡 | IR not cached in hot path (`orm.single()`/`query()` recompile per call) | ✅ Fixed: `OrmManager` reuses the registry IR (compiled once at register); `compileCount` stays 0 in the hot path. |
| A6 | 🟡 | `help_source/` confusing coexistence | ⬜ Pending (cleanup) |

### 3️⃣ Security

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | 🟠 | Latent SQL injection via dead `_formatGroup` | ✅ Resolved (dead code gone, A1) |
| S2 | 🟡 | DDL interpolates `spec.db_type`/`defaultValue` raw (trusted dev source, no validation) | ⬜ Pending |
| S3 | 🟢 | `.env` with `PGPASSWORD` committed / no `.gitignore` | ✅ Resolved (`.gitignore` present, `.env` untracked) |

### 4️⃣ Performance

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| P1 | 🟡 | Includes as correlated subqueries (per-row server-side re-evaluation, no shared join scan — **not** N+1) | ✅ Fixed: includes now render as `LEFT JOIN LATERAL`; result shape unchanged |
| P2 | 🟢 | No IR cache in hot path | ✅ Fixed via A5 |
| P3 | 🟢 | Schema inspection sequential per table | ✅ Acceptable |

### 5️⃣ Readability / Hygiene

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| H1 | 🟢 | No root `README.md` | ⬜ Pending |
| H2 | 🟢 | TypeScript version mismatch: core 6.0.3, test-project 5.4.0 | ⬜ Pending |
| H3 | 🟢 | Comments in Russian | ✅ Acceptable |
| H4 | 🟢 | Monorepo vs `file:` dependency inconsistency | ⬜ Pending |

---

## Execution plan

### Phase 1 — Correctness (✅ COMPLETED)

- T1.1 ✅ — Integration harness (`a36dcea`): replaces the 27 pure-function unit tests with a real-DB harness. NOTE: `pgType`/`diffToHealth`/`compile` unit tests were **removed**; pure functions now covered only indirectly.
- T1.2 ✅ — Decimal/float/bigint/numeric support (in `fd28a9f`).
- T1.3 ✅ — `diffToHealth` renamed (in `fd28a9f`).
- T1.4 ✅ — `go()`/`update().go`/`delete().go` throw without adapter (single; multi still open).
- T1.5 ✅ — `findById` PK lookup via `isPrimary` (`035696a`).
- T1.6 ✅ — Schema DDL correctness: PK/serial, bool/ref types, FK generation (`ba16cbd`).
- T1.7 ✅ — Query-layer fixes: filters, UPDATE/DELETE, includes to-one/to-many, `create()`, `OrmManager` export (`035696a`).

### Phase 2 — Architecture debt

- T2.1 ✅ — Delete dead SQL renderers (done, stale).
- T2.2 ✅ — Unify include mental model (single `Relation` class).
- T2.3 ⬜ Make `toSql()` adapter-independent.
- T2.4 ✅ — Add IR cache in hot path (reuse registry IR; `compileCount` test).
- T2.5 ⬜ Clean `help_source/`.

### Phase 3 — Medium effort

- T3.1 ✅ — Render nested includes recursively in `_buildIncludeSubquery` (D5) (`6e7d915`).
- T3.2 ✅ — Make `.default()` reach DDL (`irToColumns`/`renderSql`) (D6) (`78cff3b`).
- T3.3 ✅ — Make `alias()` affect the DB column name (D7).
- T3.4 ✅ — Decide bigint id typing (`number` vs `string`) (D8): adapter normalizes `int8` → `number`; use uuid/string PK for >2^53.
- T3.5 ✅ — Multi `select().go()` should throw without adapter (C5) (`5f217a4`).
- T3.6 ⬜ Reduce type-layer complexity (TODO 4.1).
- T3.7 ✅ — Correlated-subquery → LEFT JOIN LATERAL.
- T3.8 ⬜ Security lint for DDL.

### Phase 4 — Hygiene

- T4.1 ⬜ Add root `README.md`.
- T4.2 ⬜ Add root `.gitignore` (✅ present).
- T4.3 ⬜ Align TypeScript versions.
- T4.4 ⬜ Migrate `test-project` to workspace protocol.

---

## Verification checklist

- [x] `npm run check:type` (core) — no type errors.
- [x] `tsc -p packages/sql-pg` — no type errors.
- [x] `npm run lint` — no lint errors (core + sql-pg + sql-types).
- [x] `npm run format:check` — prettier happy (core + sql-pg + sql-types).
- [x] `npm run test:project` — 69 pass (requires docker `db:up`).
- [x] `test-project: npm run typecheck` — tests typechecked, clean.
- [x] `npm run build` — succeeds.

## Rules for agents working here

- Do **not** resurrect the dead SQL renderers in `single.ts`.
- All SQL generation must go through `SqlGenerator` (adapter) or the extracted pure `renderSql`.
- Every schema type change must be reflected in `pgType()`, `normalizeType()`, and `irToColumns()` together.
- The PK is identified by `FieldIR.isPrimary` — never by field name or `type === 'primary'` alone.
- New behavior without tests is **blocked** — this is an ORM. Integration tests live in `test-project/test/`.
- Integration tests need Postgres: `cd test-project && npm run db:up`, then `npm run test:project`.
- Keep PRs under ~300 lines; split phases into separate commits/PRs.
