# Issue Register

Prioritized defects, risks, fixes and blockers. Severity: **S1** data loss / unsafe DB access / security, **S2** money / closing / concurrency correctness, **S3** broken core workflow, **S4** auth/RBAC gaps, **S5** migrations/constraints, **S6** missing features, **S7** UX, **S8** tests/docs/maintainability.
Status: `OPEN`, `IN PROGRESS`, `FIXED (verified)`, `FIXED (unverified)`, `DECISION NEEDED`, `BLOCKED`, `RESOLVED (no defect)`.
Evidence references point to [VERIFICATION_LOG.md](VERIFICATION_LOG.md) entries (`VL-nn`).

| ID | Sev | Title | Status |
|---|---|---|---|
| ISSUE-001 | S2 | Closing advisory locks acquired in inconsistent order → deadlock | FIXED (verified on PG) |
| ISSUE-002 | S2 | Advisory-lock errors swallowed inside PG transactions | FIXED (verified on PG) |
| ISSUE-003 | S1 | `validatePostgresTargetSafety` is fail-open for remote hosts | FIXED (verified) |
| ISSUE-004 | S8 | Test suites depend on protected files, suite order, or stale caches | FIXED (verified) |
| ISSUE-005 | S1 | `next build` / `next start` load `.env.local` (remote Neon) on dev machines | OPEN |
| ISSUE-006 | S3 | Offline delivery completion/exception queue not wired into the delivery UI | FIXED (verified on PG; browser check pending) |
| ISSUE-007 | S8 | Postgres-only code paths have no live-PG test coverage | IN PROGRESS |
| ISSUE-008 | S5 | Orders persisted as `[ORDER_JSON:{...}]` inside `delivery_tasks.delivery_notes` | DECISION NEEDED |
| ISSUE-009 | S3 | Delivery orders auto-assigned to a hardcoded driver ("Suresh") | FIXED (verified, SQLite) |
| ISSUE-010 | S4 | Manager lacks `finance.manage`; contradicts PRD §2.2 | DECISION NEEDED |
| ISSUE-011 | S1 | Hardcoded dev admin password and personal admin email defaults in `env.ts` | DECISION NEEDED |
| ISSUE-012 | S4 | Legacy roles (`ACCOUNTANT`, `KITCHEN_OPERATIONS`) still assignable through the staff API | DECISION NEEDED (depends on ISSUE-010) |
| ISSUE-013 | S8 | Task 67/68 tests assert role navigation removed by Task 69 | FIXED (verified) |
| ISSUE-014 | S8 | `npm test` is unsafe in the working tree and omits suites | FIXED (`npm run test:safe`); legacy `npm test` still unsafe |
| ISSUE-015 | S8 | Conflicting / duplicated historical documentation | IN PROGRESS |
| ISSUE-016 | S1 | Historic report says migrations 0006–0011 were applied to remote Neon `neondb` | BLOCKED (owner verification) |
| ISSUE-017 | S8 | Two ERP dev servers listening on port 3001 simultaneously | OPEN (user action) |
| ISSUE-018 | S8 | `local-db.ps1` publishes the container on all WSL interfaces (compose uses 127.0.0.1) | OPEN |
| ISSUE-019 | S5 | SQLite test schema vs PG migration drift | RESOLVED at table level; columns unverified |
| ISSUE-020 | S1 | All Task 01B.49–75 work is uncommitted | DECISION NEEDED (needs approval) |
| ISSUE-021 | S2 | Concurrent delivery completions both applied (duplicate events/audit, last-writer-wins collection) | FIXED (verified on PG) |
| ISSUE-022 | S1 | `migrateSqliteToPostgres` defaults its source to `data/erp.db` when `requireFixture` is not set | OPEN |
| ISSUE-023 | S6 | Delivery page has no manual assign/reassign UI (`DispatchBoardView`, `DriverRunView`, `BatchAssignModal` are unused) | OPEN |
| ISSUE-024 | S5 | Partial-delivery quantities persisted only as free text in `delivery_notes` | OPEN (part of ISSUE-008) |

---

## ISSUE-001 — Closing lock ordering deadlock (S2) — FIXED (verified)
- **Where:** [financeService.ts](../apps/erp/src/server/finance/financeService.ts) `acquireClosingSharedLock` / `acquireClosingExclusiveLock`.
- **Defect:** a division writer took shared locks `division → COMBINED`; a COMBINED finalizer took exclusive locks `COMBINED → PG → TIFFIN`. A PG writer and a COMBINED finalization running at the same time formed a cycle.
- **Evidence (before):** `pg_closing_locks` on live PG16 → `40P01 deadlock detected`, 2/14 passed; under 12 concurrent writers the finalization failed outright (VL-08).
- **Fix:** single canonical order `COMBINED → PG → TIFFIN` for every shared and exclusive acquisition.
- **Evidence (after):** 14/14 on three consecutive runs (VL-09); SQLite regressions finance/task53/task61 still pass (VL-10).
- **Acceptance:** no 40P01 under interleaving or contention; a finalization waits for in-flight writers and its snapshot contains every committed transaction for the date. ✔

## ISSUE-002 — Swallowed advisory-lock errors (S2) — FIXED (verified)
- **Defect:** both helpers wrapped lock queries in `try { } catch { }`. On PostgreSQL a failed statement aborts the transaction, so the swallowed error resurfaced later as "current transaction is aborted", or (with a non-aborting failure) protection was skipped silently.
- **Fix:** removed the catch; errors propagate and roll back the transaction.
- **Evidence:** `pg_closing_locks` section 3: the simulated lock failure surfaces to the caller and no ledger row is written (VL-09).

## ISSUE-003 — Fail-open PG target safety check (S1) — FIXED (verified)
- **Where:** [pgIntegration.ts](../apps/erp/src/server/database/pgIntegration.ts) `validatePostgresTargetSafety`.
- **Defect:** it returns `safe: true` for any host that does not contain "prod" and is not `EXPECTED_NEON_HOST`. With `EXPECTED_NEON_HOST` unset, the rehearsal Neon DB or the `.env.local` Neon DB pass as "safe". Used by `runPostgresMigrations()` and `scripts/seed-local-admin.js` (the seed script has its own strict pre-check, so it is currently protected; `runPostgresMigrations` is not).
- **Acceptance:** default-deny: only loopback hosts and non-protected local/dev/test/verify database names pass; the protected rehearsal name is always rejected; unit tests cover remote Neon hosts with and without `EXPECTED_NEON_HOST`.
- **Fix:** rewritten as default-deny (protocol check, decoded DB name, protected-name block on raw and decoded forms, production block, loopback only, forbidden generic names). `ALLOW_TEST_MIGRATION` / `ALLOW_PRODUCTION_TEST` no longer override anything. The old assertion "permits rehearsal access when ALLOW_TEST_MIGRATION=true" was replaced: Task 01B.73 and the owner policy prohibit any rehearsal access.
- **Evidence:** `postgresql_integration_and_readiness` gained 8 assertions (remote Neon without EXPECTED_NEON_HOST, remote host with a local-looking name, protected name on loopback, percent-encoded protected name, `neondb` on loopback, http protocol, accepted local and verify targets). The percent-encoded case failed on the first attempt and was corrected (VL-12).

## ISSUE-004 — Fragile / unsafe test dependencies (S8) — FIXED (verified)
Observed in the sandbox baseline (VL-05, VL-10):
- `auth_hardening` copies `data/erp.db.backup.20261015192957` (a copy of protected data) to test restore. **BLOCKED in sandbox.** Fix: build the restore fixture synthetically.
- `task01b_63`, `task01b_64` assert that `data/erp.db` *exists* (size/mtime must match). Fix: treat "absent before and after" as untouched.
- `postgresql_phase01` calls `getDb()` without running migrations, so it only passed when an earlier suite had left `tests/test_erp.db` populated (order dependency).
- `async_bridge_and_notifications` case 1.3: `checkDemoProvenance()` returns a cached `false`; the test never calls `invalidateDemoProvenanceCache()`.
- **Acceptance:** every suite passes or is explicitly SKIPPED/BLOCKED in `run-sandboxed-tests.ps1` with no access to `data/`, and results do not depend on suite order.
- **Fixes:** `auth_hardening` builds a synthetic SQLite backup fixture (legacy-schema upgrade coverage dropped: SQLite is decommissioned); task63/64 treat "absent before and after" as untouched; `postgresql_phase01` migrates its own DB and points the SQLite-to-PG utility at a synthetic fixture (it previously resolved to `data/erp.db`, see ISSUE-022); `async_bridge` invalidates the provenance cache per case.
- **Evidence:** VL-14: 38/38 runnable suites pass; the sandbox `data/` holds no files after the run.

## ISSUE-005 — Production build/start reads remote Neon config on dev machines (S1) — OPEN
- `apps/erp/.env.local` points at remote Neon `neondb` (host classified, values not read into logs). `next build`/`next start` load `.env.local` but not `.env.development.local`.
- **Mitigation now:** documented as "do not run" in PROJECT_HANDOFF §6.2; build verification is done in the sandbox (no env files).
- **Proposed fix (needs owner agreement because it changes ops):** move the Neon URL out of `.env.local` into the deployment environment, or add a startup guard that refuses non-loopback DB hosts unless `ERP_ALLOW_REMOTE_DATABASE=true` is set by the deployment.

## ISSUE-006 — Offline delivery queue not wired (S3) — FIXED (verified on PG; browser check pending)
- `modules/delivery/offlineQueue.ts` exports `enqueueDeliveryAction`, but no component calls it. `SingleScreenDeliveryModal` posts directly to `/api/delivery/tasks/[id]/deliver`; offline, the request fails and nothing is queued. `DriverRunView` and `/offline` only *drain* the queue. Regression from the Task 01B.70 redesign (previous page enqueued `COMPLETE_DELIVERY` / `REPORT_EXCEPTION`).
- **Evidence:** `task01b_66_mobile_pwa` 2 failing assertions (VL-10); grep shows no caller of `enqueueDeliveryAction`.
- **Acceptance:** when offline (or on network error), completing a delivery enqueues a `COMPLETE_DELIVERY` action carrying the same payload and idempotency key; the queue syncs on reconnect via `/api/delivery/sync`; server-side idempotency prevents double collection.
- **Fix:** `SingleScreenDeliveryModal` uses one idempotency key per opened task, enqueues when `navigator.onLine === false` or on a network failure, and shows a "saved on this phone" state. `offlineQueue` keeps a sanitized `itemsReconciliation` and accepts the caller's key. `syncDeliveryActions` now forwards delivered/undelivered quantities, reason and item reconciliation (they were silently dropped). `ErpShell` replays the queue automatically on the `online` event.
- **Evidence:** `pg_delivery_sync` 19/19 on live PG; with the pre-fix code restored in the sandbox it fails 4 checks (VL-13). `task01b_66` updated to assert the new location. **Not yet verified in a browser/PWA on a phone.**
- Driver shortfall/exception: delivering 0 portions with a reason moves the task to `EXCEPTION` (`pg_delivery_sync` section 5); the redesigned page has no separate exception button.

## ISSUE-007 — No live-PG coverage for PG-only code (S8) — IN PROGRESS
- All legacy suites run on the SQLite double; `isPostgres` branches (advisory locks, `FOR UPDATE`/`FOR SHARE`, `information_schema`) are never executed. `live_postgresql_integration` targets a hardcoded DB and drops its `public` schema.
- **Done:** `tests/pg_closing_locks.test.ts` (closing protocol) on a disposable PG16.
- **Acceptance:** live-PG tests for every money-moving workflow (rent/deposit/expense, reversal, settlement, tiffin payment, invoice issue/allocate/cancel, handover accept, walk-in/dine-in sale) and migration apply-from-empty.

## ISSUE-008 — Order data embedded in delivery notes (S5) — DECISION NEEDED
- `orderService.createUnifiedOrder` serializes order metadata/items into `delivery_tasks.delivery_notes` as `[ORDER_JSON:{...}] <human notes>`; `deliveryService.extractCleanUserNotes` parses it back. No order table, no FK to products, no queryable totals or status history; dine-in orders exist only as ledger rows.
- **Proposal:** add `orders` + `order_items` tables (migration 0012), dual-write, backfill by parsing existing markers, then switch reads. Needs a product decision on order lifecycle (edit/cancel/refund rules).

## ISSUE-009 — Hardcoded driver assignment (S3) — FIXED (verified, SQLite)
- `deliveryService.getCanonicalSureshDeliveryStaff` picks `username = 'suresh_del'` or `full_name LIKE '%suresh%'`; order creation assigns and auto-dispatches to that person, falling back to the *creating actor* (a manager/owner) when none matches.
- **Acceptance:** assignment resolves to a configured default driver, else an active `DELIVERY_PERSON`; never a non-delivery role; no name matching.
- **Fix:** `getDefaultDeliveryStaff()`: `ERP_DEFAULT_DELIVERY_USERNAME` (active `DELIVERY_PERSON` only), else the longest-serving active delivery person. `getCanonicalSureshDeliveryStaff` remains as a deprecated alias. UI copy shows the actual assignee. **Deployment note:** set `ERP_DEFAULT_DELIVERY_USERNAME` when more than one delivery account exists.
- **Deviation from the first acceptance draft:** with no configuration and several drivers, orders go to the longest-serving driver instead of staying unassigned, because the live Delivery page has no manual-assignment UI (ISSUE-023) and PENDING tasks would be stranded.
- **Evidence:** `task01b_70` inserts a newer driver named "Suresh Kumar" and asserts it is not preferred unless configured (VL-14).

## ISSUE-010 — Manager cannot record money movements (S4) — DECISION NEEDED
- PRD §2.2 grants the Manager rent charge/payment, deposit and expense entry. `ROLE_PERMISSIONS.OPERATIONS_MANAGER` has `finance.read` only; `finance.manage` belonged to the now-retired `ACCOUNTANT`. Today only the Owner can post rent payments, expenses, tiffin payments, invoices or closings.
- **Options:** (a) grant `finance.manage` to Manager (matches PRD); (b) add a narrower `finance.record` permission for entries while keeping reversals, closing finalize/reopen and invoice cancel Owner-only (recommended); (c) keep Owner-only and amend the PRD.

## ISSUE-011 — Hardcoded credentials / personal data defaults (S1) — OPEN
- [env.ts](../apps/erp/src/server/database/env.ts): a demo admin password literal is the non-production fallback when `ERP_ADMIN_PASSWORD` is unset; `DEFAULT_ADMIN_EMAIL` is a personal Gmail address; default admin full name is a real person's name. Production rejects the demo password; the email and name defaults still apply in production.
- `scripts/local-db.ps1` and `docker-compose.local-db.yml` embed local-only DB credentials (low risk, loopback only).
- **Acceptance:** no personal data or reusable passwords in source; development without `ERP_ADMIN_PASSWORD` generates a random password printed once; admin email must come from env (fail closed in production).

## ISSUE-012 — Legacy roles assignable (S4) — OPEN
- `isValidRole` accepts `ALL_ROLES`, so `POST /api/staff` and `PUT /api/staff/[id]/role` accept `ACCOUNTANT` / `KITCHEN_OPERATIONS`. Those users get server permissions but no navigation (`ErpShell` only lists canonical roles).
- **Acceptance:** creation and role change accept only `CANONICAL_ROLES`; existing legacy-role accounts keep working until migrated (listed for the owner).

## ISSUE-013 — Stale role-navigation tests (S8) — FIXED (verified)
- `task01b_67` (3 assertions) and `task01b_68` (1) require `ACCOUNTANT` navigation and older bottom-bar layouts removed deliberately by Task 01B.69/70. Update the assertions to the canonical three-role model; do not delete them.

## ISSUE-014 — Unsafe / incomplete test entry points (S8) — FIXED (safe runner)
- `npm test` runs in the working tree (stats `data/erp.db`, writes `tests/dist`, `tests/test_erp.db`) and omits `task73`–`75`, `postgresql_phase01`, `async_bridge_and_notifications`, `fixture_isolation_and_transaction_integrity`, `migration_safety_guard`, `postgresql_integration_and_readiness`.
- **Done:** [scripts/run-sandboxed-tests.ps1](../scripts/run-sandboxed-tests.ps1) runs every suite in an isolated copy.
- **Done:** `npm run test:safe` alias, documented in PROJECT_HANDOFF section 6.4. Runs every `tests/*.test.ts`, including suites missing from `npm test`.
- **Remaining:** the legacy `npm test` / `test:*` scripts still run in the working tree; leave them unused or retire them once the owner agrees.

## ISSUE-015 — Conflicting documentation (S8) — IN PROGRESS
- `reasons.md`: Task 01B.70 and 01B.73 sections duplicated three times; Task 01B.71 section misnumbered "11".
- `FEATURE_FLOW_STATUS.md`: "22 suites" vs "29 suites/2,408 assertions"; `test:tiffin` 85 vs 258 assertions; Task 62 defects listed as open in module tables and fixed in §6; claims "100% pass", which is false (VL-05).
- No reports exist for Tasks 01B.72, 01B.74, 01B.75 (tests exist for 74/75).
- **Resolution:** both files keep their history but carry a banner pointing to the four verified documents; verified status lives only in FLOW_VERIFICATION.md.

## ISSUE-016 — Historic remote migration (S1) — BLOCKED
- The Task 01B.71 section of `reasons.md` states migrations 0006–0011 were applied to remote Neon `neondb`. By policy we do not reconnect to check. Migrations are additive (`CREATE TABLE`, `ADD COLUMN`); applying them to a DB that already ran 0000–0005 is expected to be non-destructive, but this is inferred, not verified.
- **Needed:** the owner checks the Neon project (console, `drizzle.__drizzle_migrations`) to confirm which migrations ran and that no data loss occurred.

## ISSUE-017 — Duplicate dev servers (S8) — OPEN (user action)
- PIDs observed: one `next dev` bound to 127.0.0.1:3001, another to 0.0.0.0:3001. Browser vs LAN requests hit different processes with a shared `.next` dir. Not stopped by us (user processes).

## ISSUE-018 — Local DB container published on all WSL interfaces (S8) — OPEN
- `local-db.ps1 start` uses `-p 5432:5432`; the compose file uses `127.0.0.1:5432:5432`. The running container shows `0.0.0.0:5432`. Low risk under WSL NAT, but inconsistent with the stated loopback-only policy.

## ISSUE-019 — SQLite vs PG schema drift (S5) — RESOLVED (table level)
- 38 SQLite table names vs 34 PG; the four extras (`*_v`, `sessions_new`) are SQLite rebuild-temporary tables. Column-level parity not yet checked.

## ISSUE-020 — Uncommitted work (S1) — DECISION NEEDED
- 43 modified, 4 deleted, 121 untracked paths since `a1c7755`. One disk failure or mistaken `git clean` loses Tasks 01B.49–75.
- **Proposal (requires approval):** create branch `wip/01b-takeover-snapshot` and commit the explicit file list (source, migrations, tests, scripts, docs, reports), excluding `.env*`, `data/`, `storage/`, `*.db*`, `tests/dist`, `scratch/*.png`. No push.

## ISSUE-021 — Duplicate concurrent delivery completion (S2) — FIXED (verified on PG)
- `completeDeliveryTask` read the task, then updated `WHERE id = ?`. Two completions arriving together (online retry vs offline replay, double tap) both passed the status check and both wrote: duplicate `DELIVERED` events and audit rows, and the later write overwrote the collection fields.
- **Fix:** both UPDATEs add `AND status NOT IN ('DELIVERED', 'EXCEPTION')`; when no row changes, events and audit are skipped and the current task is returned (idempotent).
- **Evidence:** `pg_delivery_sync` section 3 forces both reads before either write. Pre-fix: 2 events / 2 audit rows; post-fix: 1 / 1 (VL-13).

## ISSUE-022 — SQLite-to-PG utility defaults to the protected DB (S1) — OPEN
- `migrateSqliteToPostgres()` without `requireFixture` resolves its source via `resolveDbPath()`, which falls back to `data/erp.db` (and creates `data/` as a side effect). Any invocation with a configured PG URL would read the protected file. No script calls it today; the test now passes an explicit fixture.
- **Acceptance:** the utility requires an explicit `sqlitePath`; no implicit fallback to `data/erp.db`.

## ISSUE-023 — No manual assignment UI on the live Delivery page (S6) — OPEN
- `/delivery` renders its own list plus `SingleScreenDeliveryModal`. `DispatchBoardView`, `DriverRunView` and `BatchAssignModal` are not imported anywhere. Reassigning a task (driver sick, second driver) is only possible through the API.
- **Acceptance:** Owner/Manager can assign or reassign a PENDING/ASSIGNED/OUT_FOR_DELIVERY task from `/delivery`; dead components either wired in or removed.

## ISSUE-024 — Partial-delivery data stored as free text (S5) — OPEN
- Delivered/undelivered portions and reasons are appended to `delivery_notes` (`[Recon - ...]`, `[Qty - ...]`); no columns exist, so shortfall reporting requires parsing text. Resolve together with ISSUE-008.

---

## Execution plan

| Batch | Scope | Acceptance criteria | Status |
|---|---|---|---|
| 1 | ISSUE-001, -002 | `pg_closing_locks` 14/14 on live PG ×3; closing SQLite suites green | **Done** |
| 2 | ISSUE-003, -004, -013, -014 | target validator default-deny with tests; every sandbox suite PASS or explicit BLOCKED with reason; no suite touches `data/` | **Done** |
| 3 | ISSUE-006, -021 | offline completion enqueued with idempotency; task66 green; PG tests for sync idempotency and races | **Done** (browser check in Batch 7) |
| 4 | ISSUE-009 done; ISSUE-012, -011 await decisions | no name-based assignment; canonical roles only; no personal data/password literals | Partly done |
| 5 | ISSUE-007, -022 | live-PG tests for every money-moving workflow; utility requires an explicit SQLite source | Next |
| 6 | ISSUE-008, -010 | after owner decisions | Waiting |
| 7 | ISSUE-023 + browser E2E + website build + docs | core flows exercised in a browser against the local stack; FLOW_VERIFICATION updated | |
