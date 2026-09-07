# Kadmium — Project Review & Agent Plan

> Honest multi-axis review (correctness, architecture, security, performance, readability)
> with a prioritized execution plan. Generated 2026-08-29.
> Updated 2026-08-29 — Phase 1 (correctness) + integration test harness completed.
> Updated 2026-09-05 — importance fields, corrected findings (T1 removed, A3-A7 added).
> Updated 2026-09-07 — includes refactor done (`1cacf6a`): record-based API, ~relInfo phantom. A5+A6 resolved (`f3917da`). A4 resolved (`c138f7b`). A7 resolved (`9e45588`). A3 partially resolved.

## Repository snapshot

- **Monorepo** (npm workspaces): `packages/core` (ORM + CLI), `packages/sql-types` (interfaces), `packages/sql-pg` (PostgreSQL adapter).
- **Git**: initialized (`fd28a9f`). Root `.gitignore` present; `test-project/.env` is **untracked**.
- **Tests**: `test-project/test/` — integration harness against real Postgres (docker compose): `global-setup.ts` seeds via the ORM layer before vitest; 12 files / 69 tests pass. `npm run test:project` + `test-project` has `typecheck`.
- **help_source/**: gitignored legacy scaffolding; clean it up eventually.

## Verdict

Architecturally sound, well-decoupled IR contract, good CLI. Correctness layer (schema DDL + core query path) now verified against a live DB and substantially fixed; includes refactored to record-based API (−117 lines net). **Still not production-ready**: type error in `model.test.ts:44` (`foreignKey` on `StandardField`), single.ts 419 lines with ~12 `any` casts, 95 lint warnings, no README, S2 (DDL injection) unresolved.

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
| A2 | 🟠 | Two incompatible include mental models (`RelationBuilder` vs `IncludedRelation`) | ✅ Fixed: includes refactored to record-based API (`1cacf6a`). Single `Relation` class simplified (246→133 lines). `IRelationBuilder` deleted. |
| A3 | 🟠 | `toSql()` requires a live adapter | ⬜ By design |
| A4 | 🟡 | Type layer is ~60% of ORM code | 🟡 Partial: pure type files moved to `.d.ts` (`orm/types/*`, `model/types/*`). Real consumer compile-speed win still needs shipping built `.d.ts` (`main`/`types` → `dist`) — deferred. |
| A5 | 🟡 | IR not cached in hot path (`orm.single()`/`query()` recompile per call) | ✅ Fixed: `OrmManager` reuses the registry IR (compiled once at register); `compileCount` stays 0 in the hot path. |
| A6 | 🟡 | `help_source/` confusing coexistence | ⬜ Pending (cleanup) |
| A7 | 🔴 | **single.ts 419 lines, ~12 `any` casts** — breaks type-safety in query builders | ⬜ Open — down from 537/18, further reduction needed |
| A8 | 🔴 | **diff.ts split into 5 files** — was 696 lines, now divided by SRP | ✅ Resolved (`c138f7b`): `diff/types.ts`, `diff/compute.ts`, `diff/apply.ts`, `diff/render.ts`, `diff/index.ts` |
| A9 | 🟡 | **BaseWhereBuilder (49 lines) — dead code** — not used by any builder | ✅ Resolved (`f3917da`): deleted, shared `addOrCondition()` in `where-helpers.ts` |
| A10 | 🟡 | **_or() duplicated** in single.ts and multi.ts — ~25 lines of identical logic | ✅ Resolved (`f3917da`): shared `addOrCondition()` in `where-helpers.ts` |
| A11 | 🟡 | **create()/execute() duplicated** in PgAdapter and TransactionalPgAdapter | ✅ Resolved (`9e45588`): shared `createRow()` and `rawQuery()` helpers |

### 3️⃣ Security

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | 🟠 | Latent SQL injection via dead `_formatGroup` | ✅ Resolved (dead code gone, A1) |
| S2 | 🟡 | DDL interpolates `spec.db_type`/`defaultValue` raw (trusted dev source, no validation) | ✅ Resolved (`8ec96a0`): `renderDefault()` now escapes backslashes |
| S3 | 🟢 | `.env` with `PGPASSWORD` committed / no `.gitignore` | ✅ Resolved (`.gitignore` present, `.env` untracked) |
| S4 | 🟡 | **pgTypes global mutation** — conflicts with other pg users | ✅ Resolved (`04ee7e1`): per-pool `createKadmiumTypes()` |
| S5 | 🟡 | **_or() race condition** when reusing builder in parallel async | ⬜ Open — see security.md |

### 4️⃣ Performance

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| P1 | 🟡 | Includes as correlated subqueries (per-row server-side re-evaluation, no shared join scan — **not** N+1) | ✅ Fixed: includes now render as `LEFT JOIN LATERAL`; result shape unchanged |
| P2 | 🟢 | No IR cache in hot path | ✅ Fixed via A5 |
| P3 | 🟢 | Schema inspection sequential per table | ✅ Acceptable |
| P4 | 🟢 | **ResultReshaper O(n × m)** — quadratic reshaping | ✅ Verified optimal for typical cases (pre-computation overhead offsets benefit) |
| P5 | 🟢 | **unpackIncludes recursive** — O(n × k) per-row traversal | ✅ Optimized: `Map.get()` O(1) instead of `find()` O(k) |

### 5️⃣ Readability / Hygiene

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| H1 | 🟢 | No root `README.md` | ⬜ Pending |
| H2 | 🟢 | TypeScript version mismatch: core 6.0.3, test-project 5.4.0 | ⬜ Pending |
| H3 | 🟢 | Comments in Russian | ✅ Acceptable |
| H4 | 🟢 | Monorepo vs `file:` dependency inconsistency | ⬜ Pending |

### 6️⃣ Testing

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| TG1 | 🟡 | **No unit tests for ORM layer** — proxy system, query builders, relation builder | ✅ Fixed (`dec901e`): 147 cases in `packages/core/test/orm/` |
| TG2 | 🟡 | **ResultReshaper not tested** — critical component, no unit tests | ✅ Fixed (`36951f7`): 11 cases in `packages/sql-pg/test/result-reshaper.test.ts` |
| TG3 | 🟡 | **Proxy system not tested in isolation** — FilterProxy, SelectProxy, RelationProxy | ✅ Fixed: covered in `query-proxies.test.ts` (included in TG1) |
| TG4 | 🟢 | **pgType/diffToHealth/compile unit tests removed** — pure functions covered only indirectly | ✅ Fixed (`dec901e`): compileModel 30 cases + TG5 below |
| TG5 | 🟡 | **No unit tests for Model DSL, field builders, codegen, DDL adapter, sql-generator** | ✅ Fixed (`dec901e`): 226 cases across 19 new test files |

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

### Phase 2 — Architecture debt (✅ COMPLETED)

- T2.1 ✅ — Delete dead SQL renderers (done, stale).
- T2.2 ✅ — Unify include mental model: record-based API (`1cacf6a`), `IRelationBuilder` deleted.
- T2.3 ⬜ Make `toSql()` adapter-independent — still open.
- T2.4 ✅ — Add IR cache in hot path (reuse registry IR; `compileCount` test).
- T2.5 ⬜ Clean `help_source/` — still open.

### Phase 3 — Medium effort

- T3.1 ✅ — Render nested includes recursively in `_buildIncludeSubquery` (D5) (`6e7d915`).
- T3.2 ✅ — Make `.default()` reach DDL (`irToColumns`/`renderSql`) (D6) (`78cff3b`).
- T3.3 ✅ — Make `alias()` affect the DB column name (D7).
- T3.4 ✅ — Decide bigint id typing (`number` vs `string`) (D8): adapter normalizes `int8` → `number`; use uuid/string PK for >2^53.
- T3.5 ✅ — Multi `select().go()` should throw without adapter (C5) (`5f217a4`).
- T3.6 🟡 Reduce type-layer complexity — type-only files extracted to `.d.ts`; shipping built declarations deferred.
- T3.7 ✅ — Correlated-subquery → LEFT JOIN LATERAL.
- T3.8 ⬜ Security lint for DDL — still open.
- T3.9 ⬜ Ship built declarations: set `main`/`types` → `dist` (`.js` + `.d.ts`) so consumers load pre-compiled output instead of `.ts` source — deferred.

### Phase 4 — Hygiene

- T4.1 ⬜ Add root `README.md`.
- T4.2 ✅ — Root `.gitignore` present.
- T4.3 ⬜ Align TypeScript versions.
- T4.4 ⬜ Migrate `test-project` to workspace protocol.

---

## Verification checklist

- [x] `npm run check:type` (core) — 1 error (`model.test.ts:44` — `foreignKey` on `StandardField`).
- [x] `npm run lint` — 95 warnings (all `@typescript-eslint/no-explicit-any`), 0 errors.
- [x] `npm run format:check` — prettier happy (core + sql-pg + sql-types).
- [x] `npm run test:project` — requires docker `db:up`.
- [x] `npx vitest run` (root) — unit tests pass (packages/core + packages/sql-pg).
- [ ] `test-project: npm run typecheck` — blocked by type error.
- [x] `npm run build` — succeeds.

## Rules for agents working here

- Do **not** resurrect the dead SQL renderers in `single.ts`.
- All SQL generation must go through `SqlGenerator` (adapter) or the extracted pure `renderSql`.
- Every schema type change must be reflected in `pgType()`, `normalizeType()`, and `irToColumns()` together.
- The PK is identified by `FieldIR.isPrimary` — never by field name or `type === 'primary'` alone.
- New behavior without tests is **blocked** — this is an ORM. Integration tests live in `test-project/test/`.
- Integration tests need Postgres: `cd test-project && npm run db:up`, then `npm run test:project`.
- Keep PRs under ~300 lines; split phases into separate commits/PRs.
