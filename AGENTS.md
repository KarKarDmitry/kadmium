# Kadmium — Project Review & Agent Plan

> Honest multi-axis review (correctness, architecture, security, performance, readability)
> with a prioritized execution plan. Generated 2026-08-29.
> Updated 2026-08-29 — Phase 1 (correctness) + test harness completed.

## Repository snapshot

- **Monorepo** (npm workspaces): `packages/core` (ORM + CLI), `packages/sql-types` (interfaces), `packages/sql-pg` (PostgreSQL adapter).
- **Total source**: ~6 200 TypeScript lines (+ help_source/test-project scaffolding).
- **No `.gitignore` at root** (not a git repo yet — `node_modules`/`.env` will leak if init'd).
- **`.env` committed** in `test-project/` with local Postgres creds (low sensitivity, but remove or template).
- **Help_source** contains a full `dist/` + test suite of a prior `kadmium-core` version — confusing coexistence with current code.
- **Tests**: `test-project/test/` has 27 unit tests via vitest (compile, pgType, diffToHealth). Root `test:project` works.

## Verdict

Architecturally sound, well-decoupled IR contract, good CLI. Phase 1 (correctness) completed. **Still not production-ready**: architectural debt remains (dead code, dual include mental models, silent fallbacks), no README/.gitignore, TS version mismatch.

---

## Five-axis findings (after Phase 1 fixes)

### 1️⃣ Correctness — FIXED

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| C1 | 🔴 Critical | Decimal/float silently truncated to integer | ✅ Fixed: added `'decimal'|'float'|'bigint'|'numeric'` to `FieldType` + `normalizeType` + `pgType`. `BigIntPrimaryField.type` fixed to `'bigint'`. |
| C2 | 🔴 Critical | `diffToHealth` bug | ✅ Fixed: renamed `HealthCheckResult.summary` to `tablesMissing`/`tablesExpected`/`tablesMatching`; `tablesMissing = diff.summary.addedTables`. |
| C3 | 🔴 Critical | No automated tests | ✅ Fixed: vitest harness in `test-project/test/`, 27 tests, `npm run test:project` works. |
| C4 | 🟠 Required | `findById` type/runtime mismatch | ⬜ Pending |
| C5 | 🟠 Required | `go()` returns `[]` silently without adapter | ✅ Fixed: now throws `Error`. |
| C6 | 🟠 Required | bigint PK defaulted to integer | ✅ Fixed via C1. |

### 2️⃣ Architecture — pending

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| A1 | 🟠 Required | **Dead code with SQL-injection risk** (`single.ts:469-513`). `_renderIncludes`, `_formatGroup`, `_isCondition` — never called, inline string values. | ⬜ Pending (delete) |
| A2 | 🟠 Required | Two incompatible include mental models | ⬜ Pending |
| A3 | 🟠 Required | `toSql()` requires a live adapter | ⬜ Pending |
| A4 | 🟡 Medium | Type layer is ~60% of ORM code | ⬜ Pending (TODO 4.1) |
| A5 | 🟡 Medium | IR not cached in hot path | ⬜ Pending |
| A6 | 🟡 Medium | `help_source/` confusing coexistence | ⬜ Pending |

### 3️⃣ Security

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | 🟠 Required | Latent SQL injection via dead code `_formatGroup` | ⬜ Pending (delete A1) |
| S2 | 🟡 Medium | DDL interpolates `spec.db_type`/`defaultValue` | ⬜ Pending |
| S3 | 🟢 Low | `.env` with `PGPASSWORD=postgres` committed, no root `.gitignore` | ⬜ Pending |

### 4️⃣ Performance — pending

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| P1 | 🟡 Medium | Includes as correlated subqueries | ⬜ Pending (TODO 2.3) |
| P2 | 🟢 Low | No IR cache in hot path | ⬜ Pending |
| P3 | 🟢 Low | Schema inspection sequential per table | ⬜ Acceptable |

### 5️⃣ Readability / Hygiene — pending

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| H1 | 🟢 Low | No root `README.md` | ⬜ Pending (T4.1) |
| H2 | 🟢 Low | TypeScript version mismatch: core 6.0.3, test-project 5.4.0 | ⬜ Pending (T4.3) |
| H3 | 🟢 Low | Comments in Russian | ⬜ Acceptable |
| H4 | 🟢 Low | Monorepo vs `file:` dependency inconsistency | ⬜ Pending (T4.4) |

---

## Execution plan (phases)

### Phase 1 — Critical correctness (✅ COMPLETED)

- T1.1 ✅ — vitest harness: `test-project/test/compile.test.ts`, `pgType.test.ts`, `diffToHealth.test.ts` (27 tests).
- T1.2 ✅ — decimal/float/bigint/numeric support: added to `FieldType`, `normalizeType`, `pgType`, `normalizePgType`, `BigIntPrimaryField.type`.
- T1.3 ✅ — `diffToHealth` renamed to clear `tablesMissing`/`tablesExpected`/`tablesMatching`.
- T1.4 ✅ — `go()`/`update().go`/`delete().go` now throw if no adapter.
- T1.5 ⬜ `findById` type fix.

### Phase 2 — Architecture debt

- T2.1 ⬜ Delete dead SQL renderers (`single.ts:469-513`).
- T2.2 ⬜ Unify include mental model.
- T2.3 ⬜ Make `toSql()` adapter-independent.
- T2.4 ⬜ Add IR cache in hot path.
- T2.5 ⬜ Clean `help_source/`.

### Phase 3 — Medium effort

- T3.1 ⬜ Reduce type-layer complexity (TODO 4.1).
- T3.2 ⬜ Correlated-subquery → LEFT JOIN LATERAL migration plan.
- T3.3 ⬜ Security lint for DDL.

### Phase 4 — Hygiene

- T4.1 ⬜ Add root `README.md`.
- T4.2 ⬜ Add root `.gitignore`.
- T4.3 ⬜ Align TypeScript versions.
- T4.4 ⬜ Migrate `test-project` to workspace protocol.

---

## Verification checklist

- [x] `npm run check:type` — no type errors.
- [x] `npm run lint` — no lint errors.
- [x] `npm run format:check` — prettiier happy.
- [x] `npm run test:project` — tests pass (27/27).
- [ ] Build: `npm run build`.

## Rules for agents working here

- Do **not** resurrect the dead SQL renderers in `single.ts`.
- All SQL generation must go through `SqlGenerator` (adapter) or the extracted pure `renderSql`.
- Every schema type change must be reflected in `pgType()`, `normalizeType()`, and `irToColumns()` together.
- New behavior without tests is **blocked** — this is an ORM.
- Keep PRs under ~300 lines; split phases into separate commits/PRs.
- `test:project` = `cd test-project && npm run test` (vitest).
