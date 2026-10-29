# Verification Log

Every check run during the takeover, with environment type and exact outcome. Environment types:
**STATIC** (code reading), **TSC** (type check, no emit), **SQLITE** (legacy suites on the SQLite test double, isolated sandbox), **PG-LIVE** (real PostgreSQL 16, disposable local container), **BROWSER** (not yet performed), **RUNTIME** (process/port inspection).

Sandbox = an isolated copy of the repo with no `.git`, `data/`, real `.env*`, `*.db*` or `storage/`; `node_modules` is junctioned to the real install; `DATABASE_URL`/`DIRECT_URL`/SMTP variables are unset. The protected files `data/erp.db*` were never opened, statted or copied. No remote database was contacted.

---

### VL-01 · 2026-10-29 · RUNTIME · Git baseline
`git status --porcelain`, `git log -1`, `git stash list` → branch `master`, HEAD `a1c7755` (2026-10-22), 43 modified, 4 deleted (`scratch/check_*.ps1`, `scratch/check_viewport.js`), 121 untracked paths, 0 stashes. Nothing staged.

### VL-02 · TSC · ERP type check
`npx tsc -p apps/erp/tsconfig.json --noEmit --incremental false` (DATABASE_URL unset) → exit 0, 0 errors.

### VL-03 · TSC · Test type check
`npx tsc -p tests/tsconfig.json --noEmit` → exit 0, 0 errors.

### VL-04 · STATIC · Environment targets (host class + DB name only; no credentials printed)
| File | DATABASE_URL target |
|---|---|
| `apps/erp/.env.development.local` | loopback · `ravinarayana_erp_local` |
| `apps/erp/.env.local` | **remote Neon** · `neondb` |
| `apps/erp/.env.local.template` | loopback · `ravinarayana_erp_local` (placeholder) |
| `.env.example` | placeholder remote host · `postgres` |

### VL-05 · SQLITE · Baseline, all suites (sandbox, before any change)
Compiled with `npx tsc -p tests/tsconfig.json` (exit 0). Skipped: `live_postgresql_integration` (drops schema of a hardcoded local DB), `task01b_74` (seeds local dev DB), `task01b_75` (real SMTP).
- **Pass (rc=0):** delivery, finance, fixture_isolation_and_transaction_integrity, integration_audit, invoicing, kitchen, kitchen_inventory, migration_safety_guard, performance_and_caching, postgresql_integration_and_readiness, rbac_staff_foundation, rooms_residents, task50, 51, 52, 53, 54, 55, 56, 57, 58, 61, 69, 70, 71, 73, tiffin.
- **Fail:** async_bridge_and_notifications (1: demo-provenance cache), auth_hardening (needs `data/erp.db.backup.*` → BLOCKED by policy), otp_auth_flow (sandbox lacked `.env.example`; sandbox artefact), postgresql_phase01 (`no such table: staff_users`, order dependency), task63 (1) and task64 (1) (assert `data/erp.db` exists), task66 (2: offline enqueue missing), task67 (3) and task68 (1) (stale role-nav assertions).
- SMTP errors seen in otp logs are thrown by in-test mocks (verified in source), not real network calls.

### VL-06 · RUNTIME · Local services observed
- Port 3000: website `next dev`. Port 3001: **two** ERP `next dev` processes (127.0.0.1 and 0.0.0.0). Port 5432: WSL relay → container `ravinarayana-postgres-local` (`0.0.0.0:5432` inside WSL). Not modified.
- WSL `Ubuntu-22.04` was stopped at first check; a `wsl` invocation started it, and the dev container auto-restarted with it (restart policy `unless-stopped`).

### VL-07 · PG-LIVE · Migrations apply from empty
Disposable container `rn_erp_verify_pg` (postgres:16-alpine, tmpfs, `127.0.0.1:55432`, DB `rn_erp_verify_test`). Ran `scripts/migrate.js runMigrations(url)` from the sandbox (no env files) → validator accepted loopback/test target; **12 migrations applied, 34 public tables**. Only NOTICE-level output.

### VL-08 · PG-LIVE · `pg_closing_locks` against the original lock code
→ **2 passed, 11 failed.** `40P01 deadlock detected` between PG writer and COMBINED finalizer; under 12 concurrent writers the COMBINED finalization never committed; lock-failure probe was swallowed (expense written without the lock).

### VL-09 · PG-LIVE · `pg_closing_locks` after ISSUE-001/002 fix
Three consecutive runs → **14 passed, 0 failed** each (stress runs persisted 4, 11 and 2 writes; 0 outside the snapshot each time).

### VL-10 · SQLITE + PG-LIVE · Full regression via `scripts/run-sandboxed-tests.ps1 -PgVerifyUrl <disposable>`
- PASS: delivery, finance, fixture_isolation, integration_audit, invoicing, kitchen, kitchen_inventory, migration_safety_guard, **otp_auth_flow**, performance_and_caching, **pg_closing_locks**, postgresql_integration_and_readiness, rbac, rooms_residents, task50–58, 61, 69, 70, 71, 73, tiffin.
- FAIL (unchanged causes, see ISSUE-004/006/013): async_bridge (1), auth_hardening (1, BLOCKED), postgresql_phase01 (order dependency), task63 (1), task64 (1), task66 (2), task67 (3), task68 (1).
- SKIPPED: live_postgresql_integration, task74, task75.

### VL-11 · STATIC · Leads checked by reading code
- Advisory locks exist (in `financeService.ts`), and `finalizeDailyClosing` previews inside the transaction with `FOR UPDATE`; `acceptCashHandover` asserts the TIFFIN closing lock and has an optimistic `status = 'DECLARED'` guard → both earlier "defect" claims are resolved in code.
- `[ORDER_JSON:...]` still present in orderService/deliveryService/SingleScreenDeliveryModal (ISSUE-008).
- Suresh name matching present at `deliveryService.getCanonicalSureshDeliveryStaff` (ISSUE-009).
- Middleware enforces CSRF on all mutating `/api/*` requests and requires a session cookie for non-auth APIs; permission checks live in services.
- Table-name drift SQLite vs PG explained by rebuild-temp tables (ISSUE-019).

### VL-12 · SQLITE · Batch 2: target validator and fragile-test fixes
- `postgresql_integration_and_readiness`: first run after the validator rewrite **43 passed, 1 failed** (percent-encoded protected name `phase01b%2Dtest` accepted because only the raw URL was pattern-checked). Fixed by also checking the decoded name → PASS.
- `postgresql_phase01`: after adding its own migrations it progressed from crashing at assertion 14 to **82 passed, 2 failed**. Both failures came from Suite 8 resolving its SQLite source to `data/erp.db`; it now uses a synthetic fixture → PASS. (In the sandbox the file never existed; in the working tree this suite would have opened the protected DB read-only — ISSUE-022.)
- `auth_hardening`, `task01b_63`, `task01b_64`, `async_bridge_and_notifications`, `task01b_67`, `task01b_68` → PASS.
- Runner fixes: a sandbox `data/` directory created by `resolveDbPath()` tripped the guard (now only files under it abort); `-Suites a,b` arrived as one string under `powershell -File` (now split).

### VL-13 · PG-LIVE · Batch 3: `pg_delivery_sync` (disposable container, loopback :55432)
- With the fix: **19 passed, 0 failed** (offline completion keeps partial data; replay `IDEMPOTENT_IGNORED`; forced read-read-write-write race → one DELIVERED event, one audit row; cross-account `CONFLICT`; zero delivered → `EXCEPTION`).
- Discrimination check: with the pre-fix `deliveryService.ts` restored **in the sandbox copy only**: **15 passed, 4 failed** (partial data dropped; 2 DELIVERED events; 2 audit rows; zero-delivered not moved to EXCEPTION). A first race variant without forced interleaving passed against the old code and was replaced.
- `pg_closing_locks` re-run after its refactor to the shared `tests/helpers/pgVerifyTarget.ts` guard: **14 passed, 0 failed**.

### VL-14 · SQLITE + PG-LIVE · Full regression after Batches 2–4 (`run-sandboxed-tests.ps1 -PgVerifyUrl <disposable>`)
- **38 PASS, 0 FAIL, 3 SKIPPED** (`live_postgresql_integration`, `task01b_74`, `task01b_75`: live resources by design).
- One intermediate failure (`task01b_70`: fleet summary saw 2 drivers because the new decoy driver stayed active) fixed by deactivating the decoy after the resolver assertions.

### VL-15 · TSC + BUILD · Final code
- `npx tsc -p apps/erp/tsconfig.json --noEmit --incremental false` → exit 0.
- `next build` for `apps/erp` **inside the sandbox** (no `.env*` other than the placeholder template, `DATABASE_URL` unset, so no database reachable) → exit 0, "Compiled with warnings" (warnings not yet triaged). Not run in the working tree because `next build` would load `apps/erp/.env.local` (remote Neon).
