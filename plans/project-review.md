# Kadmium — Project Review & Agent Plan

> Honest multi-axis review (correctness, architecture, security, performance, readability)
> with a prioritized execution plan. Generated 2026-08-29.
> Updated 2026-08-29 — Phase 1 (correctness) + integration test harness completed.
> Updated 2026-09-05 — importance fields, corrected findings (T1 removed, A3-A7 added).
> Updated 2026-09-07 — includes refactor done (`1cacf6a`): record-based API, ~relInfo phantom. A5+A6 resolved (`f3917da`). A4 resolved (`c138f7b`). A7 resolved (`9e45588`). A3 partially resolved.
> Updated 2026-09-08 — A1 resolved (`b709ad1` + `f5023c9`): snapshot terminals + public `.clone()`. F7 resolved (`2f251dc`). A3 fully resolved (`c78c0e7` + `2ec3067` + `72e66fc`): any-casts → 4 inherent, write-finalizer.ts + include-utils.ts extraction.
> Updated 2026-09-08 — plan sync: A6/help_source gone, S5 resolved via A1, T2.3 resolved by design via `createDebugAdapter()`, T3.8 covered by S2 (`ddl-validate`), verification checklist refreshed (typecheck pass, 284/194/98, lint 89w+2e).
> Updated 2026-09-08 — project re-review: P6 (batch upsert N+1) added, D5 (standalone orm unusable) added, T5 (duplicated type helpers) added, A12 (global state/singleton) added, H5 (dead example scripts) added.
> Updated 2026-09-10 — full five-axis re-review: A13-A21 (architecture duplication, sql-generator 692 lines), S6-S8 (DML validation, DDL edge cases), P6-P8 (computeDiff N+1, applyDiff no tx, batch sizing), TG6-TG11 (CLI tests, diff tests, any-casts in tests, console.log, inter-test deps, null filters), C9-C11 (relation.ts name/collection, empty data, duplicate joins).
> Updated 2026-09-11 — decisions: C9 verified NOT a bug (include-FROM reads `targetIr.collection`, tableContext value is dead); C10 deferred to separate adapter-level validation module; TG11 decision `eq(null)` → `IS NULL` (listed in testing.md TG11). Verdict updated accordingly.
> Updated 2026-09-11 — code landings: C9 done (`6a82a14`: relation.ts stores `collection` + tests incl. SQL regression); TG11+S5 done (`6572887`: `eq(null)`/`neq(null)` → IS NULL/IS NOT NULL + undefined throw, `_renderCondition` renders IS ops without right-hand side and rejects non-whitelisted ops). S6/S9-S11 are now moot — see security.md. Completed rows moved to 📦 Done.
> Updated 2026-09-11 — code landings: S7 done (`aa29c92`): `assertSqlIdentifier` on DML collection names + DB-free tests; C11 done (`c98f947`): duplicate joins deduped in AST; S8 done (`ea589e2`): escaped quotes in DDL expression validation. Tests: core 315, sql-pg 215, project 115; lint baseline 87 (2 errors in includes.d.ts).
> Updated 2026-09-11 - code landings: P5 computeDiff done (`8e727d4`): batched introspection `inspectAll*` — 4 round-trips независимо от N (замер 10→4), O(1); TG9+TG10 done (`8c515df`): debug-логи убраны (5), count() самодастаточен; TG6 partial (`de01375`): CLI `init` покрыт unit-тестами; TG8 verdict — 35 white-box кастов (не ~100), аccepted; S7 won't fix (DEFAULT — SQL-выражение). Tests: core 323, sql-pg 251, project 117; lint baseline 87 (2 errors in includes.d.ts, untouched).

## Repository snapshot

- **Monorepo** (npm workspaces): `packages/core` (ORM + CLI), `packages/sql-types` (interfaces), `packages/sql-pg` (PostgreSQL adapter).
- **Git**: initialized (`fd28a9f`). Root `.gitignore` present; `test-project/.env` is **untracked**.
- **Tests**: `test-project/test/` — integration harness against real Postgres (docker compose): `global-setup.ts` seeds via the ORM layer before vitest; 12 files / 69 tests pass. `npm run test:project` + `test-project` has `typecheck`.
- **help_source/**: gitignored legacy scaffolding; clean it up eventually.

## Verdict

Architecturally sound, well-decoupled IR contract, good CLI. Correctness layer (schema DDL + core query path) verified against a live DB; includes refactored to record-based API (−117 lines net); builders hardened for safe reuse (`.clone()` + snapshot terminals); where-op rendering hardened (allowlist `VALID_OPS`, correct `IS NULL`/`IS NOT NULL`, `eq(null)`/`neq(null)`). **Still not production-ready**: `sql-generator.ts` at 692 lines, missing DML identifier validation, no transactional DDL, zero CLI tests, 85 lint warnings + 2 pre-existing errors.

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
| C9 | 🔴 | **relation.ts:57 uses `targetIr.name` instead of `targetIr.collection`** for table context — single.ts:63 and multi.ts:66 correctly use `ir.collection`. If adapter reads table context expecting collection names, includes generate `FROM "Post"` instead of `FROM "posts"`. | ✅ Done (`6a82a14`): verified NOT a bug (include-FROM reads `inc.targetIr.collection`, tableContext value is dead) → relation.ts now stores `collection`, `relation.test.ts:55` assert fixed + SQL regression test added |
| C10 | 🟡 | **`create({})` (empty object) silently passes through `_mapAliases`** — no validation that data keys match model fields. Unknown keys silently ignored. | ⏸ Deferred — не в scope курсора/фильтров: валидация ключей → отдельный модуль валидации данных на уровне адаптера |
| C11 | 🟡 | **`join()` on MultiQueryBuilder has no duplicate-join guard** — calling with same left/right alias silently adds duplicate JOINs. | ✅ Resolved (`c98f947`): дубликат пары (left, right, direction) в АСТ не добавляется — see project-review |

### 2️⃣ Architecture

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| A1 | 🟠 | Dead SQL renderers `single.ts:469-513` (`_renderIncludes`/`_formatGroup`/`_isCondition`) | ✅ Resolved (already removed — stale finding) |
| A2 | 🟠 | Two incompatible include mental models (`RelationBuilder` vs `IncludedRelation`) | ✅ Fixed: includes refactored to record-based API (`1cacf6a`). Single `Relation` class simplified (246→133 lines). `IRelationBuilder` deleted. |
| A3 | 🟠 | `toSql()` requires a live adapter | ✅ By design — preview via `createDebugAdapter()` (no DB; execute/create throw) |
| A4 | 🟡 | Type layer is ~60% of ORM code | 🟡 Partial: pure type files moved to `.d.ts` (`orm/types/*`, `model/types/*`). Real consumer compile-speed win still needs shipping built `.d.ts` (`main`/`types` → `dist`) — deferred. |
| A5 | 🟡 | IR not cached in hot path (`orm.single()`/`query()` recompile per call) | ✅ Fixed: `OrmManager` reuses the registry IR (compiled once at register); `compileCount` stays 0 in the hot path. |
| A6 | 🟡 | `help_source/` confusing coexistence | ✅ Resolved: directory removed from the repo. |
| A7 | 🔴 | **single.ts 419 lines, ~12 `any` casts** — breaks type-safety in query builders | ✅ Resolved (`c78c0e7` + `2ec3067` + `72e66fc`): single.ts → ~405 lines, 4 inherent `any` only (overload impl signatures, findById phantom PK, go() result, include callback). Update/delete finalizer extracted to `write-finalizer.ts`; include resolution deduped via `include-utils.ts` (`buildRelation` + `configureRelation`). Lint warnings 97→89. |
| A8 | 🔴 | **diff.ts split into 5 files** — was 696 lines, now divided by SRP | ✅ Resolved (`c138f7b`): `diff/types.ts`, `diff/compute.ts`, `diff/apply.ts`, `diff/render.ts`, `diff/index.ts` |
| A9 | 🟡 | **BaseWhereBuilder (49 lines) — dead code** — not used by any builder | ✅ Resolved (`f3917da`): deleted, shared `addOrCondition()` in `where-helpers.ts` |
| A10 | 🟡 | **_or() duplicated** in single.ts and multi.ts — ~25 lines of identical logic | ✅ Resolved (`f3917da`): shared `addOrCondition()` in `where-helpers.ts` |
| A11 | 🟡 | **create()/execute() duplicated** in PgAdapter and TransactionalPgAdapter | ✅ Resolved (`9e45588`): shared `createRow()` and `rawQuery()` helpers |
| A12 | 🟡 | **sql-generator.ts 692 lines** — `_buildSelectQueryText` 180 lines, monolithic SELECT builder | ⬜ Open — see architecture.md A13 |
| A13 | 🟡 | **PgAdapter/TransactionalPgAdapter duplicate ~60 lines** — execute/create/raw identical except pool.query vs client.query | ⬜ Open — see architecture.md A14 |
| A14 | 🟡 | **`_buildSql`/`_toSqlFrom` duplicated in 4 files** | ⬜ Open — see architecture.md A15 |
| A15 | 🟡 | **`_mapRow` duplicated** in single.ts and upsert-helpers.ts | ⬜ Open — see architecture.md A16 |
| A16 | 🟡 | **Default-select materialization duplicated 3x** in single.ts | ⬜ Open — see architecture.md A17 |
| A17 | 🟡 | **diff/render.ts duplicates DDL SQL** from ddl-adapter.ts | ⬜ Open — see architecture.md A18 |
| A18 | 🟢 | **`_pushWhere` structurally identical** in single.ts and multi.ts | ⬜ Open — see architecture.md A19 |
| A19 | 🟢 | **Dual IR caches** in orm.ts | ⬜ Open — see architecture.md A20 |
| A20 | 🟢 | **orm.ts imports Model** from model layer | ⬜ Open — see architecture.md A21 |

### 3️⃣ Security

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | 🟠 | Latent SQL injection via dead `_formatGroup` | ✅ Resolved (dead code gone, A1) |
| S2 | 🟡 | DDL interpolates `spec.db_type`/`defaultValue` raw (trusted dev source, no validation) | ✅ Resolved (`8ec96a0`): `renderDefault()` now escapes backslashes |
| S3 | 🟢 | `.env` with `PGPASSWORD` committed / no `.gitignore` | ✅ Resolved (`.gitignore` present, `.env` untracked) |
| S4 | 🟡 | **pgTypes global mutation** — conflicts with other pg users | ✅ Resolved (`04ee7e1`): per-pool `createKadmiumTypes()` |
| S5 | 🟡 | **_or() race condition** when reusing builder in parallel async | ✅ Resolved via A1 (`b709ad1`): terminals work on `sqb.clone()` snapshots — see security.md |
| S6 | 🟡 | **`expression.op` interpolated into SQL without runtime validation** | ✅ Resolved (`6572887`): `VALID_OPS` allowlist + runtime guard in `_renderCondition` — see security.md |
| S7 | 🟡 | **No identifier validation on DML path** (buildInsertSql, buildUpsertManySql) | ✅ Resolved (`aa29c92`): `assertSqlIdentifier(collectionName)` в начале всех build-хелперов + DB-free тесты — see security.md S6 |
| S8 | 🟢 | **`pg_sleep()` possible via DEFAULT** in DDL validation | 💤 Won't fix (акцептировано) — DEFAULT — SQL-выражение, корректная валидация требует SQL-парсера; пересмотреть при недоверенном вводе в DDL |
| S9 | 🟢 | **Escaped-quote false positives** in ddl-validate.ts | ✅ Resolved (`ea589e2`): `''` больше не «несбалансированный» + регресс-тесты — see security.md S8 |

### 4️⃣ Performance

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| P1 | 🟡 | Includes as correlated subqueries (per-row server-side re-evaluation, no shared join scan — **not** N+1) | ✅ Fixed: includes now render as `LEFT JOIN LATERAL`; result shape unchanged |
| P2 | 🟢 | No IR cache in hot path | ✅ Fixed via A5 |
| P3 | 🟢 | Schema inspection sequential per table | ✅ Acceptable |
| P4 | 🟢 | **ResultReshaper O(n × m)** — quadratic reshaping | ✅ Verified optimal for typical cases (pre-computation overhead offsets benefit) |
| P5 | 🟢 | **unpackIncludes recursive** — O(n × k) per-row traversal | ✅ Optimized: `Map.get()` O(1) instead of `find()` O(k) |
| P6 | 🟡 | **computeDiff 3N+1 queries** for N tables (inspectColumns + inspectIndexes + inspectForeignKeys per table) | ✅ Done (`8e727d4`) — batched `inspectAll*`, 4 round-trips независимо от N (замер: 10→4), см. performance.md P5 |
| P7 | 🟡 | **applyDiff no transaction wrapping** — partial failure leaves DB in partially-migrated state | ✅ Done (`fee95eb`) — `applyDiffTransactional` + CLI fallback prompt, см. performance.md P6 |
| P8 | 🟢 | **MAX_BATCH_ROWS hardcoded** without column count consideration | ✅ Done (`3ba5613`) — `maxBatchRows(columns)`, см. performance.md P7 |

### 5️⃣ Readability / Hygiene

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| H1 | 🟢 | No root `README.md` | ⬜ Pending |
| H2 | 🟢 | TypeScript version mismatch: core 6.0.3, test-project 5.4.0 | ⬜ Pending |
| H3 | 🟢 | Comments in Russian | ✅ Acceptable |
| H4 | 🟢 | Monorepo vs `file:` dependency inconsistency | ⬜ Pending |
| H5 | 🟢 | Dead example scripts removed; CLI reworked (see `plans/cli.md`) — `loadCodegenProject` public API, `kadmium check` added, `init` scaffolds working config+scripts, Windows path fix in ModelImporter | ✅ Resolved |

### 6️⃣ Testing

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| TG1 | 🟡 | **No unit tests for ORM layer** — proxy system, query builders, relation builder | ✅ Fixed (`dec901e`): 147 cases in `packages/core/test/orm/` |
| TG2 | 🟡 | **ResultReshaper not tested** — critical component, no unit tests | ✅ Fixed (`36951f7`): 11 cases in `packages/sql-pg/test/result-reshaper.test.ts` |
| TG3 | 🟡 | **Proxy system not tested in isolation** — FilterProxy, SelectProxy, RelationProxy | ✅ Fixed: covered in `query-proxies.test.ts` (included in TG1) |
| TG4 | 🟢 | **pgType/diffToHealth/compile unit tests removed** — pure functions covered only indirectly | ✅ Fixed (`dec901e`): compileModel 30 cases + TG5 below |
| TG5 | 🟡 | **No unit tests for Model DSL, field builders, codegen, DDL adapter, sql-generator** | ✅ Fixed (`dec901e`): 226 cases across 19 new test files |
| TG6 | 🟡 | **Zero CLI tests** — db, generate, init, format, check commands | 🟡 Partial (`de01375`) — `init` покрыт unit-тестами (scope, temp dirs); generate/check/db/format открыты — see testing.md TG6 |
| TG7 | 🟡 | **No unit tests for diff/compute, diff/apply, diff/render** | ✅ Done (`e7a90d6`) — 30 тестов + MockDdl, вскрыт баг UNIQUE-strip, см. testing.md TG7 |
| TG8 | 🟢 | **~100 `any` casts in unit tests** — masks proxy type regressions | ✅ Accepted (not a task): факт — **35** white-box кастов (12+7+10+12+0), не ~100; осознанные доступы к внутренностям proxy в тестах — see testing.md TG8 |
| TG9 | 🟢 | **console.log leftovers** in include.test.ts (3) and multi.test.ts (1) | ✅ Done (`8c515df`): убраны все 5 (включая global-setup.ts:18) — see testing.md TG9 |
| TG10 | 🟢 | **Inter-test state dependency** in single.test.ts | ✅ Done (`8c515df`): count() самодастаточен через маркерные строки — see testing.md TG10 |
| TG11 | 🟢 | **No tests for null/undefined in filters** | ✅ Done (`6572887`): `eq(null)`/`neq(null)` → `IS NULL`/`IS NOT NULL` on all 4 filters, `undefined` throws; unit + sql-pg render tests + integration test (`where.test.ts`) — see testing.md TG11 |

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
- T2.3 ✅ By design: `toSql()` requires an adapter — SQL generation lives in `SqlGenerator` (adapter layer) by contract. Adapter-free preview via `createDebugAdapter()` (`packages/sql-pg`): renders SQL without a DB, `execute()/create()/raw()` throw.
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
- T3.8 ✅ Security lint for DDL — resolved via S2: `ddl-validate.ts` (assertSqlIdentifier/assertSqlExpression/assertReferentialAction) in `8a93983`.
- T3.9 ⬜ Ship built declarations: set `main`/`types` → `dist` (`.js` + `.d.ts`) so consumers load pre-compiled output instead of `.ts` source — deferred.

### Phase 4 — Hygiene

- T4.1 ⬜ Add root `README.md`.
- T4.2 ✅ — Root `.gitignore` present.
- T4.3 ⬜ Align TypeScript versions.
- T4.4 ⬜ Migrate `test-project` to workspace protocol.

---

## Verification checklist

- [x] `npm run check:type` (core) — pass.
- [x] `test-project: npm run typecheck` — pass (`657db49` fixed the `foreignKey` cast in `model.test.ts`).
- [x] `npm run lint` — 89 warnings (mostly `@typescript-eslint/no-explicit-any`), 2 pre-existing errors in `includes.d.ts` (`'S' unused`).
- [x] `npm run format:check` — prettier happy (core + sql-pg + sql-types).
- [x] `npm run test:core` — 284 (22 files).
- [x] `npm run test:sql-pg` — 194.
- [x] `npm run test:project` — requires docker `db:up`; 98 tests.
- [x] `npm run build` — succeeds.

## Rules for agents working here

- Do **not** resurrect the dead SQL renderers in `single.ts`.
- All SQL generation must go through `SqlGenerator` (adapter) or the extracted pure `renderSql`.
- Every schema type change must be reflected in `pgType()`, `normalizeType()`, and `irToColumns()` together.
- The PK is identified by `FieldIR.isPrimary` — never by field name or `type === 'primary'` alone.
- New behavior without tests is **blocked** — this is an ORM. Integration tests live in `test-project/test/`.
- Integration tests need Postgres: `cd test-project && npm run db:up`, then `npm run test:project`.
- Keep PRs under ~300 lines; split phases into separate commits/PRs.
