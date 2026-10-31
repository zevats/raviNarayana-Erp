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

---

## Round 2 (2026-10-29, after owner decisions)

### VL-16 · RUNTIME · Snapshot commit (ISSUE-020)
Branch `wip/01b-takeover-snapshot`, commit `7b175c3` (local, not pushed). Staged by explicit path list: 202 added, 49 modified, 4 deleted (`scratch/check_*`). Pre-commit scans of all added lines: 0 private keys/tokens; every URL with embedded credentials used fake test values; no `.env`/`data/`/`*.db*`/build paths staged. Excluded `scratch/test-full-auth-flow.js` (password literal). Working tree unchanged by the commit.

### VL-17 · PG-LIVE · `pg_money_flows` first run (before fixes)
**28 passed, 6 failed** — real defects: concurrent idempotent rent payments raised raw `duplicate key` errors; two concurrent ₹3000 payments against ₹4000 due both succeeded (₹8000 paid of ₹6000 charged); concurrent double reversal created 2 reversal rows; losing handover acceptance raised a raw `duplicate key` error. Two failures were test mistakes (deposit application is `RENT_PAYMENT`/`DEPOSIT_APPLICATION`; closing with variance needs a reason; Manager settlement is allowed by the existing rule).

### VL-18 · PG-LIVE · `pg_money_flows` after fixes (ISSUE-027/028/029, 010)
**55 passed, 0 failed**: retries idempotent without raw errors; overpayment prevented; single reversal; settlement once (refund ₹5500 once, deposit application non-cash); handover accepted once, refused on finalized TIFFIN date with no ledger row; tiffin payment ×4 concurrent → 1 row, refused on finalized date; 5 concurrent invoice issuances → unique numbers; allocation cannot over-pay; paid invoice not cancellable; cancelled invoice not re-issuable; atomic rollback on simulated audit failure; §H permission matrix 19/19 (Manager allowed: charge, payment, deposit, expense, expense receipt; denied 403: reversal, closing draft/finalize/reopen, invoice create/issue/allocate/cancel, tiffin billing, settlement receipt, document archive; Driver denied all entries).

### VL-19 · PG-LIVE · Migration 0012 and orders
- `pg_orders` **34 passed, 0 failed** (first run 33/33 plus one later-added assertion; an intermediate run revealed concurrent backfill reporting conflicts as failures → per-row lock added).
- Forward migration on an existing DB (0000–0011 → 0012) and from empty: **13 migrations, 36 public tables** on fresh `rn_erp_verify_fresh_test`.
- `scripts/backfill-orders.js`: dry run reports and writes nothing; real run + re-run idempotent; a Neon/`neondb` target is refused before connecting. The validator also refused `rn_erp_verify_fresh` (name lacks local/dev/test) — fail-closed as designed.

### VL-20 · SQLITE + PG-LIVE · Full regression (final)
`run-sandboxed-tests.ps1 -PgVerifyUrl <disposable>`: **40 PASS, 0 FAIL, 3 SKIPPED** (live resources by design), then the four suites touched last (`otp_auth_flow`, `migration_safety_guard`, `postgresql_phase01`, `fixture_isolation_and_transaction_integrity`) re-run → PASS after the SMTP_USER and ISSUE-022 changes. Live-PG totals: closing locks 14, delivery sync 19, money flows 55, orders 34.

### VL-21 · TSC + BUILD · Final code
`tsc --noEmit` for apps/erp → exit 0. ERP `next build` in the sandbox (no env files, DB vars unset) → exit 0, "Compiled with warnings": dynamic `require` in `emailAdapter.ts` (pre-existing, ISSUE-033). Website `next build` in the sandbox → exit 0, 10 static routes.

### VL-22 · BROWSER · ERP end-to-end (isolated stack)
Stack: sandbox `next dev` on 127.0.0.1:3101, fresh disposable DB `rn_erp_verify_e2e_test` (13 migrations), Owner bootstrapped via `seedInitialPostgresAdmin`, `EMAIL_ADAPTER=outbox` (dev mail catcher), headless Edge via CDP. Final run **32 passed, 0 failed**:
auth guard (page redirect, API 401); password+OTP login for Owner, Manager, Driver; dashboard renders; Owner records expense and sees Reverse; Manager records expense, reversal 403, no Reverse button, owner-only closing notice, cannot create staff (403); create-staff dialog offers no retired roles; delivery order created and listed on /orders; /rooms and /residents render data; Driver routed to /delivery, finance API 403, no finance data on /finance; completion modal opens; **offline completion queued on device, auto-synced on reconnect, task DELIVERED on server** (390 px mobile emulation); no horizontal overflow at 390 px on /dashboard, /finance, /orders, /residents, /rooms, /staff, /delivery.
Earlier runs in the same session found and led to fixes for overflow on /orders (398 px) and /staff (397 px); other earlier failures were test timing/fixture issues (documented in the scripts).

### VL-23 · BROWSER · Public website (sandbox production build, 127.0.0.1:3100)
First run **20 passed, 10 failed**: every page logged a CSP violation blocking the Google Fonts stylesheet (ISSUE-030). After the CSP fix and rebuild: **30 passed, 0 failed** — 7 routes HTTP 200, unknown route 404, logo asset 200, no links to local/LAN addresses, no overflow and no console errors on 5 pages at 1366 px and 390 px.

### VL-24 · RUNTIME · Environment at end of session
All processes started in this session were stopped (sandbox ERP :3101, sandbox website :3100, headless Edge profiles `rn-e2e-*`, disposable container `rn_erp_verify_pg`). The user's `ravinarayana-postgres-local` container is still running and was never connected to. The user's ERP `next dev` (PID 23320) on :3001 was found not running near the end of the round (see ISSUE-017 note). No protected file, Neon database or remote host was accessed.

### VL-25 · 2026-10-30 · RUNTIME + BROWSER · Login/OTP outage (`ECONNREFUSED 127.0.0.1:5432`)
- Root cause: WSL `Ubuntu-22.04` was **Stopped** (WSL shuts the VM down seconds after the last WSL session exits), so Docker and `ravinarayana-postgres-local` were down; nothing listened on 5432. Configuration was correct: `next dev` uses `.env.development.local` (loopback `ravinarayana_erp_local`).
- Recovery: starting WSL auto-restarted the existing container (`unless-stopped`, volume `ravinarayana_pgdata_local` intact). Read-only check: DB reachable, 12 migrations, 1 active staff account (SUPER_ADMIN), auth tables present. No migration or seed run.
- Durable fix: `scripts/local-db.ps1 start` now also launches a hidden, labelled WSL keep-alive (`rn-erp-db-keepalive`); `stop` ends it; `status` reports it. Verified: WSL stays Running after idle.
- User's dev server (:3001): `/api/health` healthy/connected; invalid login → 401; `/login` → 200.
- Auth routes now return **503** with a plain message (raw driver error logged server-side only) when the DB is unreachable, instead of 500 with `connect ECONNREFUSED ...` (login) or a misleading 401/400 (OTP verify/resend).
- Isolated stack (sandbox `next dev` :3101, disposable DB, outbox email, synthetic accounts): API checks 32/32 for the three roles — wrong password and unknown user 401; OTP delivered; wrong OTP 401 (attempts counted); correct OTP → session; reused OTP 401; expired OTP 401; 3 wrong attempts invalidate the challenge; `/api/auth/me` role correct; per-role permissions (staff list/create, cashbook, delivery tasks) as expected; DB outage → 503 with no host/port in the response and a clear message on the login form. Browser UI login (password + OTP) 3/3 with no console errors; Owner/Manager land on /dashboard, Driver on /delivery.

## Round 4 (2026-10-30) — performance, caching, OTP latency

Environment for all measurements: sandbox copy (no env files), disposable PostgreSQL 16 (`rn_erp_verify_e2e_test`, tmpfs, 127.0.0.1:55432), synthetic Owner/Manager/Driver, `EMAIL_ADAPTER=outbox`, headless Edge via CDP, Windows desktop viewport 1366×900. DB query counts from the dev-only `ERP_DB_METRICS=1` instrumentation (`/api/dev/db-metrics`, 404 unless enabled; no SQL parameters recorded). "Settled" = URL reached, no request in flight for 700 ms, no skeleton. Your :3001 server and dev DB were not used for measurements.

### VL-26 · BROWSER · Baseline (dev mode, cold compile, Owner)
| Step | Time | API | DB queries |
|---|---|---|---|
| OTP verify API | 1,207 ms | | |
| OTP submit → dashboard settled | 12,182 ms (dashboard RSC 8,811 ms = dev compile) | | 44 incl. login |
| First visits /rooms /residents /finance /orders /delivery | 2.8 / 4.2 / 13.5 / 5.3 / 5.5 s | 1 / 2 / 3 / 6 / 9 | 3 / 5 / 8 / 26 / 24 |
| /staff | never settled in 120 s (harness heuristic + 2 polling notification bells) | 14 | 48 |
| Return visits (round 2) | 380–1,182 ms | 1–11 | 3–46 (dashboard 14) |
Findings: Orders and Delivery polled every 4 s (Delivery: 3 APIs/tick), refetched `/api/auth/me` and data on every mount; two `NotificationBell` instances each polled; staff directory fetched twice per visit; `useErpQuery` re-ran its effect on every render (inline `tags` array); 22 "today" defaults used the UTC date (wrong between 00:00–05:30 IST — requests for 2026-10-29 were observed while the business date was 2026-10-30); dashboard server cache (15 s) never invalidated by writes; dashboard division links prefetched (3 extra dashboard renders per visit in production mode).

### VL-27 · BROWSER · After changes (dev mode)
- Cold compile: first visits 3.0–5.4 s (compile-bound, all settle); return visits **77–154 ms, 0 API, 0 DB queries** on all 7 sections.
- Warm (routes compiled, as after `warm-erp-routes.ps1`): OTP verify API **203 ms**; OTP submit → dashboard settled **1,224 ms** (baseline 12,182 ms); first visits **367–572 ms** (DB 3–9 queries); return visits **54–113 ms, 0 API, 0 DB queries**. Manager: return visits 71–103 ms, 0 queries; Driver lands on /delivery.

### VL-28 · BROWSER · After changes (production build in sandbox, :3102)
`next build` in the sandbox (no env files) exit 0; first-load JS 97–122 kB. Sessions created in the disposable DB with `createSession` (prod refuses the outbox adapter, so OTP is measured in dev). First visits **89–172 ms** (prefetched, no route request on click); return visits **74–116 ms, 0 API**; 0 console errors for Owner, Manager, Driver. Division filter links were found prefetching three extra dashboard renders → `prefetch={false}` (not re-measured after the change).

### VL-29 · BROWSER · Cache invalidation proof (3 consecutive runs, 7/7 each)
Unchanged revisit of Orders/Delivery: **0 requests**. Delivery completed through the UI modal → Orders shows "Delivered · PAID" on return without reload (1 orders fetch) → Dashboard delivered count +1 on the next visit (before/after 6→7, 7→8, 8→9). First attempt failed intermittently: the dashboard's 15 s server cache was never invalidated (fixed with commit-time change signals).

### VL-30 · SQLITE + PG-LIVE · Full regression
`run-sandboxed-tests.ps1 -PgVerifyUrl <disposable>`: **41 PASS, 0 FAIL, 3 SKIPPED** (live resources by design). New `client_cache_and_signals` 22/22; live PG: closing locks 14, delivery sync 19, money flows 55, orders 34. Intermediate run: 3 failures — task67/task70 stale source assertions (dashboard now links /orders directly; legacy routes redirect server-side) and task61 computing "today" in UTC (fails 00:00–05:30 IST; fixed to the business date).

### VL-31 · BROWSER + API · Authentication after changes
`auth_verify`: **35/35** — wrong password/unknown user 401; OTP delivered (outbox) for 3 roles; incorrect, reused, expired OTP 401; 3 wrong attempts invalidate; correct OTP → session with correct role; per-role permissions (staff list/create, cashbook, delivery tasks); browser login for 3 roles with 0 console errors; DB outage → 503 with no host/port and a clear form message. SSR login HTML: form `method="post"`, submit disabled before hydration; the isolated server log since the fix contains no `password=`.

### VL-32 · RUNTIME · User environment
:3001 (your `next dev`) healthy, `/login` 200 with the new form, invalid login 401; it restarted itself on the `next.config.mjs` change (new PID 33940). Local DB `ravinarayana_erp_local`: 1 active Owner; requested Manager/Delivery emails absent; **profiles not created** (requested password is 9 characters; policy minimum is 12). WSL keep-alive running.

## Round 5 (2026-10-30) — real local app: first-visit latency, OTP stages, profiles, role isolation

**Environment ("real app").** A second `next dev` started from the working tree (same code as your :3001 server) on 127.0.0.1:3003 with its own build folder (`apps/erp/.next/verify-dev`, cleared before each cold run), connected explicitly to the local DB `ravinarayana_erp_local` on 127.0.0.1:5432 (checked in-process before start), `EMAIL_ADAPTER=outbox` (so OTPs could be read without touching a real inbox), `ERP_DB_METRICS=1`. Accounts: the two new local profiles (Owner not used — its OTP goes to a real inbox and signing in would end your own session). Headless Edge via CDP, 1366×900 unless stated. Your :3001 server (PID 30880) was not touched; my :3003 server, its browsers and the disposable PG container were stopped afterwards. Differences from your setup: email is the outbox instead of Gmail SMTP, and the DB has no migration 0012 (ISSUE-039).

### VL-33 · DB + API · Local profiles created
Pre-checks in one process: connected database = `ravinarayana_erp_local`, port 5432; exactly 1 active Owner; neither email present. Created via the existing `createStaffUser` path (Owner as actor, password supplied through an environment variable only, never written or printed): `zevats_delivery` / "Zevats Delivery" / DELIVERY_PERSON / zevats@gmail.com and `rishabh_manager` / "Rishabh Manager" / OPERATIONS_MANAGER / rishabh3725@gmail.com, both active, bcrypt hashes; Owner row (hash, email, role) unchanged. Password policy untouched. Repo, logs and scratch files scanned afterwards: password not present (the earlier ISSUE-050 row quoting the rejected password was removed; it was never committed).

### VL-34 · BROWSER · First-visit latency, by stage (Manager)
| Scenario | Login page interactive | Password → OTP field | OTP verify API | OTP → dashboard settled | First visit rooms / residents / finance / orders / delivery | Return visits |
|---|---|---|---|---|---|---|
| Cold, empty build cache, no effective warm-up | 17.7 s | 2.3 s | 1,215 ms | 14.1 s (dashboard RSC 10.9 s compile) | 3.2 / 3.9 / 4.3 / 3.0 / 4.4 s | 72–260 ms, 0 API, 0 DB |
| After fixed warm-up (pages + data APIs) | 1.2 s | 1.8 s | 1,191 ms (handler 60 ms) | 2.2 s | 0.39 / 0.43 / 0.65 / 0.38 / 0.48 s | 62–115 ms |
| Final (warm-up incl. sign-in routes + ISSUE-051), run A / run B | 2.8 / 1.8 s | 1.3 / 1.0 s | 207 / 170 ms | 1.28 / 0.99 s | 0.69 / 0.95 / 1.04 / 0.56 / 0.73 s · 0.58 / 0.53 / 0.83 / 0.54 / 0.43 s | 63–118 ms, 0 API, 0 DB |
Stage evidence: in the cold run the DB time per first visit was 30–166 ms and the APIs took 1.0–2.2 s each because every route handler compiled on first hit; the old warm-up's page requests returned `/login` redirects in milliseconds because the middleware redirects before compiling (root cause, ISSUE-048). With the fixed warm-up the protected pages take 1–4 s each to warm (real compiles); the remaining first-visit cost is dev-mode request overhead + the dev-only double RSC (VL-35) + 1–3 API calls of 100–300 ms whose DB share is 10–265 ms. `/orders` revisits refetch because its request fails (400, ISSUE-039) and errors are not cached. Warm-up of 29 routes on an empty cache: ≈73 s in the background; a second concurrent launch exits at once ("already running").

### VL-35 · BROWSER + SERVER LOG · OTP/login stages and duplicate requests
- Login API (server log `[ERP Login Request]`): total 629–711 ms = rate limit 16–36 ms + user lookup 4–8 ms + **bcrypt 535–663 ms** (cost 12, unchanged by design) + OTP flow 22–36 ms. OTP lifecycle: persistence 20–27 ms, email hand-off to the outbox 2–7 ms. **Real SMTP delivery to Gmail is not included and was not measured** (inbox not readable; that time is outside the app once the message is accepted).
- OTP verify: handler 36–60 ms; route 1,169 ms before the warm-up covered sign-in routes (compile), 77–104 ms after.
- DB queries: password step 8; OTP verify → dashboard settled 37 → **30** after ISSUE-051 (Driver → /delivery: 22–24). Before the fix the 7 notification queries each ran twice (page `getNotifications` + bell `/api/notifications`, concurrent cache misses); after: once.
- Duplicate `/dashboard` RSC (ISSUE-049): CDP initiator stacks show request 1 `Next-Router-Prefetch: 1` from `prefetch-cache-utils.js` (navigation in dev creates an `auto` prefetch: loading shell only) and request 2 from `InnerLayoutRouter` (full payload). Same pair on every first visit in dev; Next disables `router.prefetch` in development. Not an app defect; the production build prefetches ahead of the click (VL-28).

### VL-36 · API + BROWSER · Role isolation with the new profiles (real app)
`role_check_real.js` **35/35**: wrong password 401 with no OTP issued; Manager signs in by email, Delivery by username, both with password + OTP; `/api/auth/me` roles correct; Manager reads rooms/residents/transactions/delivery/staff (200) and is denied (403) reversal, closing finalize, closing reopen, invoice cancel, staff create, staff role change (non-existent ids; permission checks run before any lookup); Delivery reads its tasks, is denied (403) rooms/residents/transactions/cashbook/staff/executive report and recording an expense; Delivery is redirected from /dashboard, /rooms, /residents, /finance (→ /delivery) and /staff; Manager still opens /rooms, /residents, /finance; sign-out invalidates both sessions (401). Browser: Delivery typing `/finance` or `/rooms` ends on `/delivery` (2.1–2.4 s, full document load in dev) with no finance text rendered. First run before the page guard: /rooms and /finance opened as empty shells for Delivery (ISSUE-032). `/api/orders` is readable by Delivery by design (`delivery.read`); on this DB it returns 400 (ISSUE-039).

### VL-37 · BROWSER · Mobile (390×844, touch) on the real app
Delivery: lands on /delivery, horizontal overflow 0 px, only the run sheet is in the navigation, 0 console errors. Manager: dashboard overflow 0 px; console shows only the orders 400 (ISSUE-039). Mobile return-visit timings are not reported: the harness fell back to full page loads where the target link was not visible in the mobile bar, which resets the in-memory client cache.

### VL-38 · SQLITE + PG-LIVE · Regression after round 5
`run-sandboxed-tests.ps1 -PgVerifyUrl <disposable 127.0.0.1:55432>`: **41 PASS, 0 FAIL, 3 SKIPPED** (live-resource suites, by design). `async_bridge_and_notifications` 31/31 including 4 new checks (concurrent callers share one computation, per-caller limits, a request after a change does not join the earlier computation, only the post-change result is cached). `tsc --noEmit` (apps/erp) clean.

## Round 6 (2026-10-30) — full-stack responsiveness: root causes, page matrix, inactivity

**Environment.** Same as round 5: a verification `next dev` from the working tree on :3003 (own build folder `apps/erp/.next/verify-dev`, local DB `ravinarayana_erp_local` checked in-process, outbox email, `ERP_DB_METRICS=1`), the two local profiles, headless Edge via CDP. From the matrix run on, the browser uses `http://localhost:3003` (see ISSUE-061). Measurements are taken inside the page with `performance.now()`: **feedback** = first frame showing the click registered, **url** = path reached, **usable** = path reached, no progress bar, no skeleton, page text present; **settled** = no request for 600 ms (CDP). DB counts from the dev metrics endpoint, which now also reports PostgreSQL sessions opened since the last reset (`pg_stat_activity`, `application_name = rn-erp`). Your :3001 server: see VL-47.

### VL-39 · SERVER · Route eviction in `next dev` (root cause of "sometimes slow" / "slow after inactivity")
Next 14.2 dev defaults (`maxInactiveAge` 60 s, `pagesBufferLength` 5; `on-demand-entry-handler.js`) mark routes idle for 60 s and drop them at the *next compilation of any route*. Reproduced before the fix: after a 90 s pause nothing was dropped (no compile happened), but one compile of another route (`/api/documents`, 3.1 s) followed by `/dashboard` → **3,804 ms** (recompiled; ≈0.3 s before) while recently used `/rooms` stayed at 0.36 s. Because the warm-up compiles routes one after another for >60 s, it evicted its own first routes (`/login`, `/dashboard`) before it finished — which is how the first OTP → dashboard could still take 8–9 s on a "warmed" server. Fix: `onDemandEntries { maxInactiveAge: 24 h, pagesBufferLength: 500 }` (dev only). After the fix a complete re-warm of all 111 routes takes 10.9–13.2 s (nothing was dropped). Side effects measured: dev server ≈ 0.85–1 GB with every route compiled (16 GB machine); compiling a not-yet-compiled route costs 2.5–7 s once ~100 routes are loaded (webpack seals all live entries), so the warm-up compiles everything up front. Changing `next.config.mjs` made your running :3001 server exit (it did not come back on its own); it was restarted with `start-erp.ps1` (VL-47).

### VL-40 · DB · Connection layer
Fresh connection + first query to the local DB: 63.7 / 90.6 / 59.6 / 56.5 / 59.9 ms (SCRAM-SHA-256 + WSL relay); query on an open connection 2.3–3.5 ms. PostgreSQL itself never closes idle sessions (`idle_session_timeout = 0`); the app pool did (`idle_timeout: 120` s), so any pause > 2 min reopened up to one connection per concurrent request. Fix: 1800 s on loopback hosts, 120 s for remote hosts, `ERP_PG_IDLE_TIMEOUT_S` override. In the warm runs below `newConnections` is 0 for every navigation; DB time per section is 5–161 ms over 1–16 statements (`api_profile.js`, 7 repetitions per endpoint: p50 90–163 ms, p95 117–269 ms per API, of which DB 8–83 ms — the rest is dev-mode request overhead). The local DB holds almost no business data (3 staff users, no rooms/transactions/deliveries), so query cost at volume cannot be measured there (VL-45).

### VL-41 · BROWSER · Sign-out
| | Before | After |
|---|---|---|
| Click → visible "Signing out" | 24 ms | 22 ms |
| Logout API (server revocation) | 1,835 ms (route compiled on first use) | 183 ms (0.14–0.21 s warm via curl) |
| Click → login form usable | 2,749 ms | 897 ms (full document load of dev JS) |
| Old session cookie afterwards | 401 | 401 |
| Browser Back afterwards | stays on /login, no data | stays on /login, no data (`location.replace`) |

### VL-42 · BROWSER · Navigation responsiveness (probe.js, Manager)
- `/api/finance/*` and `/api/residents*` held for 6 s by CDP interception; click Finance, 400 ms later click Rooms → Rooms feedback 32–38 ms, usable 38–50 ms; when the held finance responses arrived 6 s later the page stayed on Rooms with Rooms data (no overwrite).
- Residents opened while its API was held: own skeleton shown, shell and nav clickable; leaving to Delivery: feedback 10–19 ms, usable 76–77 ms.
- Five nav clicks 120 ms apart: the last target wins, usable 621–634 ms after the first click, stays there.
- Fast-3G-like throttling: Orders (uncached) feedback 6–12 ms, usable 1.47–1.48 s; Dashboard (cached) usable 51–80 ms.
- Conclusion: once routes are compiled, nothing in the client blocks navigation; the reported freezes match the server compiling or recompiling routes (VL-39).

### VL-43 · BROWSER · Redirects before rendering
Typed `/kitchen` and `/tiffin`: 3.2 s (page rendered, then redirected in the browser) → 0.28–0.33 s (middleware 307). Manager typing `/staff`: real 307 → /dashboard (0.41–0.48 s). Delivery: OTP now lands directly on /delivery (no dashboard render). Before the Host fix the verification server's `127.0.0.1` browsing lost the cookie on the middleware redirect (ISSUE-061).

### VL-44 · BUILD TOOLING · Turbopack evaluated, not adopted
`next dev --turbo` on :3004 (separate build folder): full warm-up 183 s vs 233 s with webpack, but `TP1003 require.resolve("nodemailer/lib/smtp-connection")` errors on every route importing the email adapter (risk to real OTP email). Not adopted; server stopped and its folder removed.

### VL-45 · PG-LIVE · Query cost at volume (disposable database)
Database: a copy of the E2E fixture (`rn_erp_verify_scale_test`). Valid ledger and delivery rows were cloned with new ids and dates, giving 50,001 financial transactions and 30,004 delivery tasks, then `ANALYZE` was run. Each read path ran 6 times through the real services:

| Read path | p50 | Worst |
|---|---|---|
| Notifications | 21 ms | 180 ms |
| Dashboard metrics (12 queries) | 63 ms | 132 ms |
| Transactions for a month | 73 ms | 368 ms (cold) |
| Cashbook | 12 ms | 20 ms |
| Residents | 6 ms | 20 ms |
| Rooms | 6 ms | 10 ms |
| Delivery tasks for a day | 26 ms | 45 ms |
| Fleet custody | 17 ms | 24 ms |

The slowest statement is the dashboard's monthly ledger aggregate (57 ms). The hot filters are already indexed (session token, transaction date/type/resident, delivery service date, stays by room and status), so no index was added. The local DB holds almost no business data, so this could not be measured there.

### VL-46 · BROWSER · Page matrix with inactivity (real app, :3003)
Per-page tables, p50/p95 and analysis: [PERFORMANCE_MATRIX.md](PERFORMANCE_MATRIX.md).

**Manager, 54 in-app navigations:** usable at p50 260 ms, p95 507 ms, worst 779 ms.
- First visits: 270–528 ms.
- Return visits: 22–95 ms with 0 API calls and 0 queries.
- After 5 or 15 minutes away: 205–305 ms, dashboard 443–494 ms (router cache expired, so one server round trip).
- Click feedback: p50 26 ms, worst 50 ms.
- No connection was reopened after any idle period.

**Delivery (mobile):** valid through the 1- and 5-minute idles. The 15-minute phase is invalid, because an outside sign-in to the same account at 11:18 IST ended the test session under the single-session policy.

**Harness corrections made during the run:**
- Freezing the tab and timing with `requestAnimationFrame` hung after a freeze. Inactivity is now simulated by putting another tab in front, and timer lag is checked before each measurement.
- The verification server listened on `127.0.0.1`, which made middleware redirects point at `localhost` (ISSUE-061). Measurements switched to `http://localhost:3003`.

Owner page timings were not measured this round.

### VL-47 · RUNTIME · Your :3001 server
- **What happened:** the `next.config.mjs` change (route eviction fix) made the running dev server (PID 30880) exit; it did not restart on its own.
- **Recovery:** it was restarted with `scripts/start-erp.ps1` in its own minimized PowerShell window (port 3001, `0.0.0.0`, current PID 8148). That script runs no migrations and refuses to start if port 3001 is taken.
- **Other servers:** none were left running. My verification servers (:3003, :3004, :3101), the test browsers and the disposable PostgreSQL container were all stopped afterwards.
- **Final status at handover (2026-10-30 21:58 IST):**
  - `http://localhost:3001` is running (PID 8148, `next dev` from `start-erp.ps1`).
  - Health: `{"status":"healthy","database":"connected","latencyMs":3.74}`.
  - `/login` returns 200; `/dashboard` redirects to sign-in; `/api/events` returns 401 to a non-session cookie.
  - The local DB container is up, and the WSL keep-alive is running.
  - The current warm-up completed all 112 routes (one entry shows an impossible 20,548,643 ms timer value; the route itself answers in 0.9 s).
- **Degraded responsiveness:** the server has been up since 09:48 and absorbed dozens of hot rebuilds from this round's code edits. It holds 2.2 GB of private memory, only 0.85 GB resident, so it pages: trivial requests take 0.5–1.9 s. A fresh server answered in about 40–60 ms in this round's measurements. It was **not** restarted, per the instruction not to terminate the running server. **Recommended:** stop it in its PowerShell window (Ctrl+C), then run `scripts/start-erp.ps1` again; the warm-up then takes about 4 minutes.

## Round 7 (2026-10-30) — order → delivery workflow

Full write-up and matrix: [ORDER_DELIVERY_WORKFLOW.md](ORDER_DELIVERY_WORKFLOW.md).

### VL-48 · PG-LIVE · `pg_order_delivery_workflow` 46/46
Disposable PostgreSQL 16. The test creates a synthetic delivery account named "Suresh" and sets `ERP_DEFAULT_DELIVERY_USERNAME` to it. Sections:
1. Menu pricing and auto-assignment.
2. Reuse without changing history; several orders per customer per day.
3. Dine-in has no delivery task.
4. Ten validation rejections: missing, negative, excess and mismatched quantities; no reason; unknown line; over-collection; negative collection; another driver; nothing changed after rejects.
5. Three concurrent completions produce one event; repeat is a no-op; order COMPLETED.
6. Partial delivery: due ₹210 (not ₹260); ₹150 collected leaves ₹60; balance above the outstanding amount and a different method are rejected; a duplicate balance payment is counted once; two concurrent final payments, one accepted.
7. Delivered and unpaid shows as pending.
8. Not delivered: reason required, nothing collectable, idempotent repeat and offline replay.
9. Offline replay carries per-item quantities.
10. Roles.

`pg_orders` 38/38 now also checks:
- the request's price is ignored (₹1 sent, ₹90 stored);
- a later menu price change leaves the placed order unchanged;
- monthly and inactive products are rejected.

### VL-49 · BROWSER · Two-browser workflow E2E, 30/30 on two consecutive runs
Sandbox server :3101 with a disposable database, the 14-item catalog seeded there, synthetic accounts and outbox email. Manager at 1366×900 and Suresh at 390×844 with touch, side by side. Results:
- the menu shows 12 orderable items and nothing pre-selected;
- Delivery/Dine-in is the first choice;
- a ₹192 total is shown;
- a double click on Confirm creates one order, assigned to Suresh;
- the order appears in the Manager's list in 0.58–0.84 s and on the phone in ≤2 s, with no reload;
- reuse with changed quantities produces ₹192 and ₹272, and history is unchanged;
- the form starts clean;
- dine-in never reaches the phone;
- per-item steppers reconcile (3 delivered / 1 not → due ₹184);
- a missing reason and over-collection are blocked with clear messages;
- an injected 500 keeps the entries, and the retry saves;
- the outcome preview reads "Partly delivered (5 of 6) · ₹34 pending";
- the Orders page shows the partial payment in 0.62–0.79 s;
- the balance is collected once despite a double click;
- not delivered shows as nothing due;
- fully delivered and paid, and delivered and unpaid, are both shown correctly;
- Delivery gets 403 creating orders and is redirected from /orders;
- no horizontal overflow; tap targets ≥ 40 px;
- no console errors apart from the injected one.

**Earlier runs found two real defects, both fixed before the final runs:**
- ISSUE-069: the list stayed stale after a double save.
- ISSUE-067: the next order inherited the previous customer's phone.

They also exposed three script timing issues, which were corrected.

### VL-50 · SQLITE + PG-LIVE · Regression after round 7
`run-sandboxed-tests.ps1 -PgVerifyUrl <disposable>`: **42 PASS, 0 FAIL, 3 SKIPPED** (live-resource suites, by design). Highlights:
- `client_cache_and_signals` 53/53 (in-flight cancellation, bound, section redirects);
- `async_bridge_and_notifications` 31/31;
- `pg_order_delivery_workflow` 46/46;
- `pg_orders` 38/38.

`tsc --noEmit` is clean.

## Round 8 (2026-10-30) — local activation (approved) and the console 400

### VL-51 · LOCAL DB · Backup, migration 0012, backfill, menu, 400 fix, end-to-end on the real local database
Everything ran against the local database `ravinarayana_erp_local` only:
- PostgreSQL 16.15 in container `ravinarayana-postgres-local`, volume `ravinarayana_pgdata_local`, at 127.0.0.1:5432;
- the target was checked before every step;
- no remote database was contacted.

**Backup**
- File: `%USERPROFILE%\.ravinarayan-erp\backups\ravinarayana_erp_local_pre0012_20261030_221215.dump` (`pg_dump -Fc`, 151,631 bytes).
- SHA-256 `96f00e1f3ece4df79ced52d5a929db655707b0d7d413453344535968044aa694` is stored next to it in a `.sha256` file.
- Recovery was verified by restoring the file into a separate disposable PostgreSQL (`restore_verify_test`). Exit code 0; all 35 tables had identical row counts (95 rows).
- To restore if ever needed: `pg_restore --clean --if-exists -d ravinarayana_erp_local <file>`, run inside the container.

**The 400 — root cause.** It was reproduced before any change.
- `GET /api/orders?serviceDate=<today>&orderType=ALL` (Orders page load, and the Kitchen/Tiffin redirects) and `GET /api/orders/history` threw PostgreSQL `42P01 relation "orders" does not exist`, because migration 0012 was missing.
- The routes turned every exception into **400 Bad Request** with the raw SQL message.
- `/api/delivery/tasks` was unaffected: it checks for the table first.

**Migration 0012**
- Applied with `npm run db:migrate`, with `DATABASE_URL` set explicitly to the local URL. The runner's own target validator also passed.
- 13 migrations are now recorded.
- A schema diff of all columns, constraints and indexes showed **0 removed or changed, 66 added**, all on `orders` and `order_items`: 8 CHECK constraints, 6 foreign keys, 4 unique constraints, 2 primary keys and 5 secondary indexes.
- Existing rows were unchanged (3 staff, 25 audit entries, 3 sessions).

**Backfill** (`scripts/backfill-orders.js`, read before running, executed from the test sandbox's compiled build):
- Dry run, then real run, then a repeat run.
- 0 legacy delivery orders and 0 counter sales were pending, so 0 created, 0 already converted, 0 unrecoverable, 0 amount mismatches and 0 failures on every run.
- There were no historical orders in the old format on this database.

**Menu**
- Loaded with the existing loader `seedDefaultCatalogIfEmpty`, using the Owner as the acting user, the same as `POST /api/tiffin/products/seed`.
- 0 → 14 items, all active. A second call inserted 0: the loader refuses when the table is not empty.
- All 14 prices match PRD §5.1. `SNK-PARTY` ("Quoted") is intentionally not loaded.
- Three names differ from the PRD wording; prices are identical:
  - TIF-MON-BOTH, TIF-MON-SINGLE (the app adds "Package");
  - EXT-CHAAS ("Spiced Buttermilk (Chaas)" versus "Buttermilk / Spiced Chaas").

**Fix (ISSUE-073)**
- New `databaseErrorResponse()` in `server/database/availability.ts`, applied to 43 catch blocks in 34 order, delivery and tiffin routes.
- Database errors return 500 `DATABASE_ERROR` with a generic message. Constraint conflicts return 409. An unreachable database returns 503.
- The SQL detail is logged on the server only. Validation errors keep 400 and their message.
- New test `http_error_mapping` 7/7.

**API checks on the activated database** (19/19)
- `GET /api/orders` returns 200 (was 400); `/api/orders/history` returns 200; 14 active products.
- Missing phone, a non-menu line, an unknown product, a monthly package line and zero quantity each return 400 with a clear message.
- No session returns 401.
- A ₹1 price in the request is ignored, and ₹80 is stored from the menu.
- Delivery tasks, handover summary and staff return 200 for the Manager; tasks and summary return 200 for Delivery.
- Delivering 3 of 2 returns 400. A valid delivery returns 200 with due ₹160 and balance ₹60. Collecting ₹61 against a ₹60 balance returns 400.
- The Manager gets 403 on the Owner-only reversal.
- Owner, at service level (signing in would end the Owner's own session): creates an order (auto-assigned to Zevats Delivery), lists orders, and sees all delivery tasks.

**Browser end-to-end on the real local database**
- Verification server :3003, the same code and database, with outbox email.
- Manager on desktop and Zevats Delivery on a 390 px phone.
- Result: **30/30**, the same matrix as VL-49, with no browser console errors. New orders reached the phone in ≤2 s and the Orders page in about 0.7 s.

**Test data**
- All records were prefixed "E2E TEST": 7 orders, 9 lines, 6 delivery tasks, 24 events, 5 customers and 1 counter-sale ledger entry.
- They were the only rows in those tables, and nothing depended on them (no handover, closing or invoice).
- They were removed in one transaction that checked each count. Audit entries were kept.
- Final state: 0 orders, deliveries, customers and transactions; 14 products; 3 staff; 13 migrations.

**Regression:** 43 PASS / 0 FAIL / 3 SKIPPED.

**Running services**
- `http://localhost:3001` is healthy (database connected), PID 8148, not restarted. It answers `/api/orders` with 401 when there is no session, so the route loads.
- The local DB container is up, and the WSL keep-alive is running.
- The verification server and the disposable database were stopped.

## Round 9 (2026-10-30) — custody and cash handover

### VL-52 · PG-LIVE · `pg_custody_ledger` 36/36 (disposable database)
Accounts: Owner, two Managers, and drivers A (Asha) and B (Bilal).

**Attribution and visibility**
- A collects ₹200 cash and ₹100 UPI; B collects ₹300 cash and ₹100 UPI. Each holds exactly their own.
- A's overview contains only A. A gets 403 on B's detail, and A's handover list never contains B's.
- A Manager receiving a ₹40 balance on A's delivery holds it themselves; A keeps the ₹60 taken at the door.

**Declaration**
- A stated cash figure (₹999) that differs from the records is rejected.
- Two simultaneous declarations: exactly one is accepted. It covers ₹260 cash, ₹100 UPI and 3 collections, computed by the server.
- A second declaration while one is pending is rejected.
- B is unchanged, and A still shows ₹260 held, awaiting acceptance.

**Verification**
- A cannot verify her own handover.
- Rejected without any change: wrong employee on screen, stale amounts, missing UPI confirmation, and UPI above the declared amount.
- Two Managers accepting at once: exactly one succeeds.
- The books get exactly one CASH ₹260 and one UPI ₹100 entry; re-acceptance is rejected.
- A then shows the handover as Accepted with nothing pending, and her delivery is handed over and linked. B is unchanged.

**Discrepancy and Owner view**
- Counting B's cash short without a reason is rejected.
- With a reason it becomes DISCREPANCY_FLAGGED: ₹300 declared, ₹250 received, variance −50, declaration kept.
- The Owner sees separate rows, with B at ₹50 short and status DISCREPANCY. The aggregate equals the sum of the rows.

**Later payments, Manager custody and history**
- A balance paid after a handover becomes a new undeclared ₹30 UPI collection.
- The Manager declares their own ₹40, cannot verify it themselves, and the Owner verifies it.
- History is intact, and declaration plus verification are both in the audit log.

### VL-53 · BROWSER · Custody E2E 18/18 (sandbox; driver A on a 390 px phone, Manager and Owner on desktop, driver B via the API)
- **A's phone:** shows only "My custody" (₹160 cash, ₹80 UPI). B's API view shows only B.
- **Declaration:** after a double tap, exactly one request, `POST /api/delivery/handover/declare` (200), the path the old page never reached (405).
- **Live updates:** the Manager sees A's declaration in 611–640 ms without refreshing. B is unchanged.
- **Failure and acceptance:**
  - An injected 500 shows the error, keeps the dialog open and reports no success.
  - The retry, sent as a double click, accepts once.
  - A sees "Cash with me ₹0" and "Accepted … Verified by E2E Manager" without refreshing.
- **B's handover:** B declares ₹240 + ₹80, and a duplicate declaration returns 400. The Manager counts ₹190: the reason is required, then the difference is recorded as a discrepancy.
- **Owner view:**
  - Suresh ₹160/₹80 handed over, Clear; Ravi ₹190 received, ₹50 short, Discrepancy.
  - The totals row equals the sum of the rows.
  - Ravi's detail shows the handover, the verifier, the reason and the collections with order numbers.
- **Server role checks:** a delivery account gets 403 on accept and 403 on reading another employee's custody.
- **Mobile and console:** no horizontal overflow, buttons at least 44 px, clean console.
- **Regression:** the order-to-delivery workflow E2E still passes 30/30.

### VL-54 · LOCAL DB · Migration 0013 applied (approved), read-only verification
- **Backup:** `%USERPROFILE%\.ravinarayan-erp\backups\ravinarayana_erp_local_pre0013_20261030_234521.dump` (169,497 bytes; SHA-256 `c6e55ce3ace91773774078c642feefeb6001efd730a39d74a08b318aa6243bc8`). Restored into the disposable PostgreSQL: all 37 tables identical (180 rows).
- **Migration:** `npm run db:migrate` with an explicit local target; 14 migrations recorded.
- **Schema diff:** 0 lines removed or changed, 34 added, all on `delivery_collections` and the four new handover columns and constraints. Every existing table's row count is unchanged.
- **Your existing data:** one real delivery order placed after round 8 (₹88 cash, delivered by Zevats Delivery) was copied into the ledger as one BACKFILL collection, attributed to Zevats Delivery and undeclared. No declaration or acceptance was made on your local data.
- **Read-only API checks (7/7):**
  - the Manager overview loads;
  - Zevats is holding ₹88;
  - the totals equal the rows;
  - Zevats sees only their own row, gets 403 on others, and their own detail lists the collection with its order;
  - the pending list loads.
- **Running services:** :3001 is healthy, and `/api/delivery/custody` answers 401 without a session.

