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
| ISSUE-005 | S1 | `next build` / `next start` load `.env.local` (remote Neon) on dev machines | OPEN (mitigated: builds only in sandbox) |
| ISSUE-006 | S3 | Offline delivery completion queue not wired into the delivery UI | FIXED (verified on PG + browser) |
| ISSUE-007 | S8 | Postgres-only code paths had no live-PG test coverage | FIXED for money flows (4 live-PG suites); other modules SQLite-only |
| ISSUE-008 | S5 | Orders persisted as `[ORDER_JSON]` text | FIXED (migration 0012 + backfill, verified on PG); JSON still dual-written (ISSUE-035) |
| ISSUE-009 | S3 | Delivery orders auto-assigned to a hardcoded driver | FIXED (verified) |
| ISSUE-010 | S4 | Manager lacked finance entry rights (PRD §2.2) | FIXED per decision (b) (verified on PG + browser) |
| ISSUE-011 | S1 | Hardcoded demo password / personal emails as defaults | FIXED (verified) |
| ISSUE-012 | S4 | Legacy roles assignable through the staff API | FIXED (verified) |
| ISSUE-013 | S8 | Task 67/68 tests assert role navigation removed by Task 69 | FIXED (verified) |
| ISSUE-014 | S8 | `npm test` unsafe in the working tree and incomplete | FIXED (`npm run test:safe`) |
| ISSUE-015 | S8 | Conflicting / duplicated historical documentation | FIXED (superseded banners; verified docs) |
| ISSUE-016 | S1 | Historic report: migrations 0006–0011 applied to remote Neon `neondb` | BLOCKED (owner to inspect Neon console) |
| ISSUE-017 | S8 | Two ERP dev servers on port 3001 | RESOLVED (no ERP server on 3001 at end of session; see note) |
| ISSUE-018 | S8 | `local-db.ps1` publishes the container on all WSL interfaces | OPEN |
| ISSUE-019 | S5 | SQLite test schema vs PG migration drift | RESOLVED at table level (V21 mirrors 0012) |
| ISSUE-020 | S1 | Task 01B.49–75 work uncommitted | FIXED (local snapshot `7b175c3` on `wip/01b-takeover-snapshot`) |
| ISSUE-021 | S2 | Concurrent delivery completions both applied | FIXED (verified on PG) |
| ISSUE-022 | S1 | SQLite→PG utility defaulted its source to `data/erp.db` | FIXED (explicit `sqlitePath` required) |
| ISSUE-023 | S6 | No manual assign/reassign UI on `/delivery` | RESOLVED (stale: `TaskPanel.tsx` has Assign/Reassign, Retry, Cancel, Resolve, Collect; `ManagerDelivery` has batch assign; re-checked 2026-11-01) |
| ISSUE-024 | S5 | Partial-delivery data stored as free text | FIXED for orders since 0012 (`order_items.delivered_quantity`); legacy rows keep text |
| ISSUE-025 | S1 | Login matched "any SUPER_ADMIN" for the admin email and rewrote Owners' emails | FIXED (verified) |
| ISSUE-026 | S4 | Manager can finalize checkout settlements incl. deposit refunds (existing rule) | FIXED (decision 2026-11-01: Manager prepares, Owner approves any deposit movement; migration 0018; pg_money_flows, task01b_52) |
| ISSUE-027 | S2 | Concurrent rent payments could exceed rent charged (overpayment race) | FIXED (verified on PG) |
| ISSUE-028 | S2 | Concurrent double reversal created two reversal rows | FIXED (verified on PG) |
| ISSUE-029 | S3 | Idempotent retries / losing handover acceptance returned raw DB errors | FIXED (verified on PG) |
| ISSUE-030 | S7 | Website CSP blocked Google Fonts (brand typefaces never loaded) | FIXED (verified in browser) |
| ISSUE-031 | S7 | Horizontal overflow on `/orders` and `/staff` at 390 px | FIXED (verified in browser) |
| ISSUE-032 | S7 | Driver opening `/finance` sees an empty shell (APIs 403) instead of a redirect | FIXED (server page guard on /rooms, /residents, /finance; VL-36) |
| ISSUE-033 | S8 | Webpack "critical dependency" warning from dynamic `require` in `emailAdapter.ts` | OPEN (pre-existing, build passes) |
| ISSUE-034 | S5 | `/api/kitchen/walkin-sale` posts counter sales without an `orders` row | OPEN (listed via legacy fallback; backfill converts) |
| ISSUE-035 | S5 | Delivery modal still reads items from `[ORDER_JSON]`; JSON dual-write remains | OPEN (transition step) |
| ISSUE-036 | S6 | Orders cannot be edited or cancelled (no endpoint) | FIXED (decision 2026-11-01: edit/cancel only before the delivery is attempted and with nothing collected; paid and dine-in orders cannot be cancelled; revisions kept; migration 0019; pg_order_lifecycle) |
| ISSUE-037 | S3 | Local PostgreSQL stops whenever WSL idles out (login 500 `ECONNREFUSED`) | FIXED (`local-db.ps1` keep-alive; VL-25) |
| ISSUE-038 | S7 | DB outage surfaced as raw 500 / misleading 401 on login and OTP routes | FIXED (503 + plain message; VL-25) |
| ISSUE-039 | S5 | Local dev DB was at migration 0011; order screens read `orders` (0012) | FIXED (0012 applied to `ravinarayana_erp_local` 2026-10-30 with approval, after a verified backup; VL-51) |
| ISSUE-040 | S7 | Delivery/Orders polled every 4 s (≈45 requests/min per open tab) and refetched on every mount | FIXED (shared cache, 20 s visible-only polling; VL-27) |
| ISSUE-041 | S7 | Return visits re-queried the DB (3–46 queries) | FIXED (0 queries on revisit; VL-27/28) |
| ISSUE-042 | S2 | 22 "today" defaults used the UTC date (wrong day 00:00–05:30 IST, incl. Delivery/Orders/check-in) | FIXED (`businessToday()`; VL-26) |
| ISSUE-043 | S1 | Login form submitted credentials via GET URL before hydration | FIXED (POST + hydration-gated submit; VL-31) |
| ISSUE-044 | S3 | Dashboard server cache (15 s) never invalidated → stale KPIs after payments/deliveries | FIXED (commit-time change signal; VL-29) |
| ISSUE-045 | S7 | Two notification bells polled independently | FIXED (shared query) |
| ISSUE-046 | S7 | OTP: double-submit possible; 350 ms artificial delay before code field | FIXED |
| ISSUE-047 | S3 | Dashboard showed zeros as real figures when its queries failed | FIXED (explicit notice) |
| ISSUE-048 | S7 | First navigation in `next dev` is compile-bound (3–5 s per section) | FIXED for dev (warm-up now actually compiles protected pages + API routes; 3.0–4.4 s → 0.43–1.04 s on the real app, VL-34); not present in production builds |
| ISSUE-049 | S8 | /dashboard route data requested twice after OTP login | RESOLVED (no app defect: Next 14.2 dev-only partial prefetch + full fetch; the real duplicate work was ISSUE-051; VL-35) |
| ISSUE-050 | S4 | Requested Manager/Delivery profiles not created (first requested password was below the 12-character policy) | RESOLVED (created 2026-10-30 with a compliant owner-supplied password via `createStaffUser`; policy unchanged; VL-33) |
| ISSUE-051 | S7 | Notification feed (7 aggregate queries) computed twice per dashboard load: page render and header bell ran concurrently and both missed the 30 s cache | FIXED (in-flight de-duplication with invalidation generation; VL-35, test 3.4) |
| ISSUE-052 | S3 | `listUnifiedOrders` defaulted the service date to the UTC day (residual of ISSUE-042) | FIXED (`getBusinessDateString()`) |
| ISSUE-053 | S3 | `next dev` dropped compiled routes idle > 60 s (beyond the last 5 used) at the next compile of any route; the warm-up evicted its own first routes → 3–4 s recompiles "sometimes", after short inactivity and on the first OTP | FIXED (`onDemandEntries` keeps routes for 24 h; VL-39, VL-44) |
| ISSUE-054 | S7 | PostgreSQL pool closed idle connections after 120 s on the local DB → 57–91 ms reconnect (SCRAM + WSL relay) per connection after a pause | FIXED (30 min idle timeout on loopback hosts, 120 s remote, env override; VL-40) |
| ISSUE-055 | S7 | Sign-out took 2.7 s: logout route compiled on first use (1.8 s), page kept in Back history, no timeout | FIXED (route warmed, `location.replace`, 5 s abort; 0.9 s total, API 0.18 s; VL-41) |
| ISSUE-056 | S2 | Client cache: a request started before a mutation was joined by the post-mutation refetch and cached (pre-change data shown after a change); a late response for an old filter/date could overwrite newer data; responses landing after sign-out / account switch were cached | FIXED (cancel in-flight on invalidate/clear/owner switch, cache-authoritative hook updates, key guard; tests SUITE 6) |
| ISSUE-057 | S7 | No visible reaction to a navigation click until the route responded | FIXED (immediate active state + progress bar, 6–40 ms; VL-42) |
| ISSUE-058 | S7 | Role/retired-section redirects ran inside the streaming boundary (full render, then browser redirect: 2.1–3.2 s); Delivery login rendered the dashboard before redirecting | FIXED (layout-level redirect before streaming, middleware redirect for /kitchen /tiffin, role-aware login landing; VL-43) |
| ISSUE-059 | S8 | Invoice ledger refetched on every Finance visit | FIXED (shared cache; Daily Closing intentionally always fresh) |
| ISSUE-060 | S8 | Warm-up covered only page-load APIs; first save/modal actions compiled on use (2.5–7 s) | FIXED (all 111 routes discovered from the source tree) |
| ISSUE-061 | S8 | Middleware redirects built from `request.url`; with `next dev -H 127.0.0.1` Next reports the host as `localhost`, so browsing via 127.0.0.1 lost the cookie on redirect | MITIGATED (redirects use the request Host; default 0.0.0.0 mode verified for localhost, 127.0.0.1 and LAN IP; `-LocalOnly` + 127.0.0.1 still affected by Next's host rewrite — use http://localhost:3001) |
| ISSUE-062 | S7 | Dev-mode limits that remain: webpack dev compile cost grows with live routes (2.5–7 s for a route not yet compiled once all are loaded); full warm-up ≈ 4 min after a server start; ~70–100 ms dev overhead per request; dev JS makes a full page load (login/sign-out) ≈ 0.9 s | OPEN (inherent to `next dev`; a production build removes them but `build:erp`/`start:erp` are prohibited on this machine) |
| ISSUE-063 | S2 | Order lines priced with the browser's `unitPrice`; free-text lines accepted | FIXED (name and price from the active menu on the server; monthly packages and inactive items rejected; VL-48) |
| ISSUE-064 | S2 | Delivery completion: items parsed from notes (₹120 fallback invented), one aggregate quantity spread by ratio, amount from an average price, collection unchecked | FIXED (per-line outcome validated on the server, due = Σ delivered × saved price, collected 0…due; VL-48/49) |
| ISSUE-065 | S2 | Further payments overwrote the collected total; no cap, lock or method check | FIXED (additive, row-locked, capped at the amount due, same method; VL-48) |
| ISSUE-066 | S3 | Orders list measured payment against the order total, not the delivered amount | FIXED (amountDue, remaining and delivery outcome per order) |
| ISSUE-067 | S3 | Order form: new idempotency key per click (duplicate on retry), first item pre-added, monthly packages offered, reuse re-added off-menu items, form not reset between orders (next order inherited the previous phone) | FIXED (draft key, clean form, orderable menu, reuse rules; VL-49) |
| ISSUE-068 | S7 | Other staff's orders and deliveries appeared only after 20-second polling | FIXED (SSE `/api/events` from commit-time change signals, polling kept as fallback; VL-49) |
| ISSUE-069 | S3 | Round-6 regression: a second invalidation cancelled an in-flight reload without notifying the page (list stale up to 20 s after two quick saves) | FIXED (cancelled keys refetch; found by E2E, VL-49) |
| ISSUE-070 | S7 | Offline replay dropped per-item quantities; replaying a recorded "not delivered" outcome was reported as a conflict | FIXED (VL-48 §8/§9) |
| ISSUE-071 | S5 | Local DB lacked migration 0012 and had no menu (0 products) | FIXED (migration + backfill (0 legacy rows) + 14-item catalog loaded with approval; VL-51) |
| ISSUE-072 | S6 | No "Suresh" staff account locally (only Zevats Delivery); PRD price override and quoted party snacks have no path | DECISION NEEDED |
| ISSUE-073 | S4 | 34 order/delivery/tiffin API routes answered every exception with **400 Bad Request**, including database failures (the console 400 was `GET /api/orders` → PostgreSQL `42P01 relation "orders" does not exist`, raw SQL text sent to the browser) | FIXED (database errors → 500 `DATABASE_ERROR`, constraint conflicts → 409, unreachable → 503, SQL detail logged server-side only; validation errors stay 400; VL-51, test `http_error_mapping`) |
| ISSUE-074 | S2 | **Handover never completed:** the Delivery page POSTed declarations to `/api/delivery/handover`, which has only a GET handler → 405 on every declaration; the working endpoint is `/api/delivery/handover/declare` | FIXED (custody panel uses `/declare`; verified 200 in browser; VL-53) |
| ISSUE-075 | S2 | Custody credited to the **assigned** driver and computed per day: cash taken by a Manager (balance at the office, or completing for a driver) landed in the driver's custody; yesterday's undeclared cash disappeared from view | FIXED (migration 0013 `delivery_collections`: one row per payment with `collected_by`; custody = all outstanding collections per staff id; VL-52) |
| ISSUE-076 | S2 | Declarations were free-typed and unlinked: unlimited declarations per day; acceptance swept every collected cash task of that driver/date (including later collections); a second declaration posted income again with nothing behind it | FIXED (declaration computed from and linked to the employee's undeclared collections; one pending at a time; acceptance settles exactly the linked collections; one ledger entry per kind) |
| ISSUE-077 | S2 | Discrepancies vanished: a short count was stored as ACCEPTED and the shortfall left custody; the Manager's button accepted the declared figure in one click (no way to enter the counted amount) | FIXED (counted cash and confirmed UPI entered separately; a difference requires a reason and sets DISCREPANCY_FLAGGED; original declaration kept; shortfall shown per employee) |
| ISSUE-078 | S2 | UPI collected on deliveries was never declared, reconciled or posted to the books | FIXED (declared UPI computed from collections, confirmed separately by the verifier, posted once as a UPI cashbook entry) |
| ISSUE-079 | S7 | Owner/Manager saw one combined "Fleet Cash Custody" figure for the selected date; pending declarations were filtered by the page date (other days' declarations invisible) | FIXED (staff-wise table, totals = sum of rows, per-employee history; pending list not date-filtered) |
| ISSUE-080 | S8 | Custody API defaulted to the UTC date | FIXED (business date) |
| ISSUE-081 | S3 | Dashboard and several API defaults used the UTC date/month (`dashboardService` "today" and 6-month window, cashbook and business-report default periods, check-out default date, delivery summary, closing preview, executive CSV, tiffin invoice due date; finance date helpers used the browser's zone) | FIXED (one utility `lib/businessDate.ts`; `pg_financial_definitions` §1) |
| ISSUE-082 | S2 | Deposits held kept counting checkout deductions (kept by the business, recorded only in `resident_settlements`) as a liability; executive CSV counted every deposit ever received | FIXED (`financialDefinitions.getDepositsHeld`; definition in `FINANCIAL_DEFINITIONS.md`; `pg_financial_definitions` §3) |
| ISSUE-083 | S2 | Outstanding rent netted across all residents (one resident's credit hid another's debt) on the dashboard, cashbook summary and executive CSV | FIXED (`getOutstandingRent`, per resident; §2) |
| ISSUE-084 | S3 | Tiffin revenue matched `description LIKE '%tiffin%'`; legacy rent-typed tiffin rows were counted as rent **and** tiffin | FIXED (stable `customer_id`/category references; rent excludes tiffin rows; §4) |
| ISSUE-085 | S7 | "Public Site" link hard-coded to `http://localhost:3000` | FIXED (configured website URL; link hidden when none is set) |
| ISSUE-086 | S8 | Calendar-dependent tests: `integration_audit` (1) and `task01b_63` (3) expect a reversal dated "today" to fall in October 2026; they fail from 1 Nov 2026 at the unmodified HEAD as well | OPEN (tests should derive the period from the reversal date) |
| ISSUE-087 | S8 | `task01b_68` asserts the Android SDK is absent (true when written; the SDK is now installed); `fixture_isolation_and_transaction_integrity` has 6 failing static checks on `migrateSqliteToPg.ts` | OPEN (pre-existing at HEAD `a3a3ccc`; not caused by current work) |
| ISSUE-088 | S6 | Tiffin customers, subscriptions, catalogue and billing had complete services but no reachable screen (`/tiffin` redirected to Orders) | FIXED (restored at `/tiffin`; pg_tiffin_management) |
| ISSUE-089 | S3 | Editing a subscription left already-listed deliveries on the old terms (meals, days, end date, quantity, address) | FIXED (`syncSubscriptionDeliveriesAfterEdit`; pg_tiffin_management §5) |
| ISSUE-090 | S4 | Creating a subscription silently turned quantity 0 / negative / fractional into a valid quantity | FIXED (rejected, same rule as editing) |
| ISSUE-091 | S4 | Default-menu seeder could be run by a Manager with no preview | FIXED (Owner only, preview then confirm, adds only missing codes, never re-prices) |
| ISSUE-092 | S3 | Notification feed was not filtered by role (money items for any caller); kitchen-plan item linked to the retired /kitchen with 0 portions; links did not open the right tab or stop | FIXED (permission-filtered feed, kitchen item removed, deep links honoured; pg_reports_and_admin §3) |
| ISSUE-093 | S7 | Successful sign-in and sign-out were not in the audit log | FIXED (`auth.signed_in`, `auth.signed_out`) |
| ISSUE-094 | S7 | Dashboard showed a hard-coded "39 beds across 21 rooms" | FIXED (live room and bed counts) |
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

## ISSUE-023 — No manual assignment UI on the live Delivery page (S6) — RESOLVED
- **2026-11-01:** the description below is out of date. The manager stop panel (`modules/delivery/ops/TaskPanel.tsx`) assigns, reassigns, retries, cancels, resolves and collects, and the Board assigns in bulk. `TaskTimelineModal` is redundant (the panel shows the same timeline from the same API) and stays unused.
- `/delivery` renders its own list plus `SingleScreenDeliveryModal`. `DispatchBoardView`, `DriverRunView` and `BatchAssignModal` are not imported anywhere. Reassigning a task (driver sick, second driver) is only possible through the API.
- **Acceptance:** Owner/Manager can assign or reassign a PENDING/ASSIGNED/OUT_FOR_DELIVERY task from `/delivery`; dead components either wired in or removed.

## ISSUE-024 — Partial-delivery data stored as free text (S5) — OPEN
- Delivered/undelivered portions and reasons are appended to `delivery_notes` (`[Recon - ...]`, `[Qty - ...]`); no columns exist, so shortfall reporting requires parsing text. Resolve together with ISSUE-008.


## ISSUE-010 — resolution (decision b, 2026-10-29)
- New permission `finance.record` (Owner, Manager, legacy Accountant): rent charge, rent payment, security deposit, expense, and upload of rent/deposit/expense receipts. `finance.manage` (Owner, legacy Accountant) keeps reversals, closing draft/finalize/reopen, invoice create/issue/allocate/cancel, tiffin billing and payments, settlement receipts and every financial document archive.
- UI: `useHasPermission` (`components/auth/CurrentUserContext.tsx`) hides Reverse, closing actions and invoice mutations for roles the server rejects; server enforcement is unchanged and authoritative.
- Evidence: `pg_money_flows` §H permission matrix (19 allow/deny checks on live PG); `finance` suite; browser E2E (manager records expense, reversal 403, no Reverse button, owner-only closing notice).

## ISSUE-011 — resolution
- `env.ts`: no default admin email (ERP_ADMIN_EMAIL required to seed), neutral default display name, retired demo password blocked by SHA-256 digest (no plaintext in source), development bootstrap generates a 24-char CSPRNG password flagged `passwordGenerated`.
- `seed-local-admin.js`: loads ERP_ADMIN_* from `.env.development.local` only; shows a generated password once on an interactive terminal, otherwise writes it to `~/.ravinarayan-erp/initial-admin-password.txt` (0600). Never logged, audited or committed.
- `emailAdapter.ts`: no default sender mailbox; `SMTP_USER` required for SMTP. `.env.example` uses placeholders and ships no admin password. Dashboard/CSV "Prepared for" uses the signed-in user, not a hardcoded name. Staff password reset rejects the retired demo password in all environments.
- Evidence: `auth_hardening` (6-pre/6-dev assertions), `otp_auth_flow`, `performance_and_caching`; E2E fixture seeded through the real bootstrap path.
- Not done here: rewriting git history that already contains the old literals (snapshot `7b175c3` and earlier commits). Redact before any push.

## ISSUE-012 — resolution
- `isAssignableRole` (canonical roles only) enforced in `createStaffUser` and `updateStaffRole`. Existing ACCOUNTANT / KITCHEN_OPERATIONS accounts keep their role and permissions untouched and can be moved to a canonical role; no rows were changed. The directory role filter still lists legacy roles so the Owner can find such accounts.
- Transition: the Owner reviews legacy accounts in Staff Administration and reassigns each (Manager or Delivery). Evidence: `task01b_56`, `rbac_staff_foundation`, browser E2E (create dialog offers no retired roles).

## ISSUE-008 / ISSUE-024 — resolution
- Migration `0012_orders.sql` (additive): `orders` (type, lifecycle status, links to delivery task XOR ledger sale, totals, UNIQUE idempotency key, source APP/LEGACY_BACKFILL, FKs RESTRICT) and `order_items` (line no, product FK SET NULL, qty/price/line_total CHECKs, delivered quantity + reason). Drizzle schema and SQLite V21 mirror it.
- `createUnifiedOrder`: one transaction for customer, task/ledger, order, items, assignment, dispatch; idempotency key lock + replay; product ids validated; no try/catch inside the transaction.
- Reads (`listUnifiedOrders`, `getCustomerOrderHistory`) use the tables, with a read-only fallback for legacy rows not yet converted. Delivery completion writes per-line delivered quantities.
- Backfill: `backfillLegacyOrders` / `scripts/backfill-orders.js [--dry-run]` — deterministic ids, per-row advisory lock and transaction, never modifies source rows, placeholder line for unrecoverable items, ledger amount authoritative for counter sales.
- Evidence: `pg_orders` 34/34 (concurrent idempotent creation, rollback, validation, line delivery, concurrent backfill ×2 + re-run, source rows unchanged, FK restrict); 13 migrations apply to an empty DB (36 tables) and 0012 applies forward on an existing one. **Not run against any shared database.** Rollout: `npm run db:migrate` then `node -r ./tests/register_paths.js scripts/backfill-orders.js --dry-run`, then without `--dry-run`.

## ISSUE-020 — resolution
- Branch `wip/01b-takeover-snapshot`, commit `7b175c3` (local only, not pushed): 202 added, 49 modified, 4 deletions (the `scratch/check_*` files). Staged by explicit path list after scanning added lines for credentials, keys, remote DB URLs and personal data. Excluded: real env files, `data/`, `storage/`, `*.db*`, build output, and `scratch/test-full-auth-flow.js` (password literal). Known content to redact before any push: the Neon development *hostname* in `reasons.md`, the personal admin email and the retired demo password in older committed files.

## ISSUE-017 — note
- At the start of this round one ERP `next dev` (PID 23320, launched from cmd 32296) listened on :3001. At the end, neither process was running. All terminations in this session were restricted to processes whose command lines matched the sandbox path or the `rn-e2e-` browser profiles; the cause of the exit is not established.

## ISSUE-025 — Login identity confusion for Owners (S1) — FIXED
- `findStaffByIdentifier` matched `OR role = 'SUPER_ADMIN'` when the configured admin email was typed (arbitrary Owner row; PRD plans two Owners) and rewrote every Owner's email to the configured admin email during login (OTP for both Owners sent to one inbox; unique-email failures). Now exact username/email match, no side effects. Evidence: `otp_auth_flow` Suite 2 (second Owner resolves to itself, email unchanged, unknown email → null).

## ISSUE-026 — Manager settlement authority (S4) — DECISION NEEDED
- `finalizeResidentCheckoutSettlement` accepts `residents.manage` OR `finance.manage`, so the Manager can finalize a checkout including a cash deposit refund (verified on PG). Decision (b) did not cover settlements; behaviour left unchanged. Options: keep (PRD lists check-out as a Manager duty) or require `finance.manage` when a refund/deduction is involved.

## ISSUE-027 — Rent overpayment race (S2) — FIXED
- Balance checked outside the transaction; two concurrent payments both passed (₹8000 paid against ₹6000 charged on live PG). Fix: per-resident advisory lock and balance recheck inside the transaction (`acquireLedgerKeyLock`). Charge reversals take the same lock.

## ISSUE-028 — Double reversal (S2) — FIXED
- Unconditional `UPDATE ... SET status='REVERSED'` let concurrent reversals each insert a reversal row (2 rows on live PG). Fix: `WHERE status = 'POSTED'` with a changes check.

## ISSUE-029 — Raw errors on idempotent retries (S3) — FIXED
- Concurrent submissions sharing an idempotency key surfaced `duplicate key` errors (rent payment/charge/deposit/expense, tiffin payment); the losing handover acceptance did the same. Fix: idempotency-key advisory lock + in-transaction replay; handover row `FOR UPDATE` with a status re-check. Data was always protected by unique indexes; callers now get the original result or a business error.

## ISSUE-030 — Website fonts blocked by CSP (S7) — FIXED
- `globals.css` imports Google Fonts but CSP allowed only `'self'`. Added `https://fonts.googleapis.com` (style-src) and `https://fonts.gstatic.com` (font-src). Verified: 0 console errors on 5 pages × 2 viewports.

## ISSUE-031 — Mobile overflow (S7) — FIXED
- `/orders` header actions and the `/staff` filter row did not wrap (398/397 px at 390). Added `flex-wrap`. Verified at 390 px on six ERP pages.

---

## Execution plan

| Batch | Scope | Status |
|---|---|---|
| 1 | Closing locks (001, 002) | Done |
| 2 | Test harness + DB-target safety (003, 004, 013, 014) | Done |
| 3 | Offline delivery + completion race (006, 021) | Done (browser-verified) |
| 4 | Default driver (009) | Done |
| 5 | Decisions: finance.record (010), roles (012), bootstrap defaults (011, 025) | Done |
| 6 | Live-PG money flows (007, 027, 028, 029) | Done |
| 7 | Orders storage + backfill (008, 024, 022) | Done |
| 8 | Browser E2E (ERP) + website build/verification (030, 031) | Done for the flows listed in FLOW_VERIFICATION |
| 9 | Next | Manual assign UI (023); retire ORDER_JSON reads (035); kitchen walk-in → orders (034); decisions 026 and 036; browser coverage for kitchen, tiffin subscriptions/billing, invoices, check-in/out, documents; live-PG coverage for kitchen inventory and residents/rooms concurrency |

## ISSUE-048 / ISSUE-049 / ISSUE-051 — First-visit latency and duplicate requests (round 5, 2026-10-30)
- **Root cause of the slow first visits (048):** `warm-erp-routes.ps1` requested pages without a session cookie. The middleware redirects such requests to `/login` (API routes: 401) *before* the route is compiled, so only `/login`, `/offline` and `/forgot-password` were ever warmed; each protected page and each API route it calls still compiled on the user's first click (≈1–2 s per API route, 3–4 s per section). The POST-only sign-in routes also compiled on first use (≈1.1 s each on login and OTP verify).
- **Fix:** the warm-up sends a random throwaway cookie value that passes the middleware's shape check but matches no session (two read-only lookups, no writes, then a `/login` redirect or 401), and also requests the API routes the pages load plus the sign-in routes (GET → 405 without running a handler). A named mutex keeps it to one instance per base URL.
- **049:** two RSC requests per first visit come from Next 14.2 in development: prefetching is disabled in dev, so navigation creates an `auto` prefetch entry (`Next-Router-Prefetch: 1`, loading-boundary shell only) and `InnerLayoutRouter` then fetches the full payload (traced with CDP initiator stacks; `prefetch-cache-utils.js` "in dev, there's never gonna be a prefetch entry"). Production builds prefetch full payloads ahead of the click (VL-28). No app change.
- **051:** the dashboard page's `getNotifications` and the header bell's `/api/notifications` ran concurrently; both missed the per-user cache, so the notification queries ran twice per dashboard load. Concurrent callers now share one in-flight computation; an invalidation bumps a generation so a computation that started before a write is never cached.

## ISSUE-063 … ISSUE-072 — Order → delivery workflow (round 7, 2026-10-30)
The full audit, design, verification matrix and pending decisions are in [ORDER_DELIVERY_WORKFLOW.md](ORDER_DELIVERY_WORKFLOW.md).
- **Evidence:** `pg_order_delivery_workflow` passes 46/46 (VL-48). The browser E2E passes 30/30 on two consecutive runs (VL-49). The full regression is 42 PASS / 0 FAIL / 3 SKIPPED (VL-50).
- **Updated tests:** `pg_orders`, `task70` and `task71` previously encoded the old behaviour (free-text lines, client prices, aggregate completion). They now assert the corrected rules.

## ISSUE-074 … ISSUE-080 — Custody and cash handover (round 9, 2026-10-30)
- **Ledger.** Migration 0013 adds `delivery_collections`: one row per payment, holding `collected_by` (a staff id), the method, the amount, the delivery and order, and the `handover_id`. It also adds `declared_upi`, `accepted_upi`, `upi_transaction_id` and `declared_by` to `driver_cash_handovers`. The migration is additive, and existing task totals were copied once, attributed to `delivered_by`, else `assigned_to`.
- **Attribution.**
  - Money taken at the door belongs to the delivery's assigned employee.
  - A later payment belongs to whoever receives it.
  - Ownership is stored on the row, never inferred from who is viewing.
- **Declaration.** The employee, or a Manager on their behalf (`declared_by` is recorded), declares the sum of their undeclared collections, which are linked in the same transaction. This runs under a per-employee advisory lock, and only one declaration can await verification at a time. A stated cash figure that differs from the records is rejected; the verifier records any physical difference.
- **Verification.**
  - The verifier must be a Manager, Owner or Accountant who is not the employee and not the declarer. The Owner may verify their own, having no one above them.
  - Cash counted and UPI received are entered separately, and UPI cannot exceed the declared amount.
  - Optional stale-record checks compare the expected employee and the declared amounts.
  - Each kind posts one ledger entry (`dch_tx_<id>`, `dch_upi_<id>`).
  - The status becomes ACCEPTED, or DISCREPANCY_FLAGGED with a mandatory reason.
  - A row lock plus a status guard make concurrent or repeated acceptance fail.
- **Views.** Delivery staff see their own custody only (403 otherwise). Manager and Owner see a staff-wise table with an aggregate row that is the sum of the rows, plus per-employee collections and handover history.
- **Live.** Writes to `delivery_collections` and `driver_cash_handovers` refresh custody views over SSE.
- **Evidence:**
  - `pg_custody_ledger` 36/36 (VL-52);
  - custody browser E2E 18/18 (VL-53);
  - `task58` updated to the corrected rules: a shortfall is now DISCREPANCY_FLAGGED, UPI must be confirmed, and UPI reaches the cashbook;
  - full regression 44/0/3;
  - read-only checks on the migrated local database 7/7 (VL-54).

