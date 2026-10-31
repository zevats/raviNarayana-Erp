# Ravinarayan ERP — Project Handoff

**Purpose:** single source of truth for architecture, scope, workflows, current state and safe setup.
**Companion documents:** [FLOW_VERIFICATION.md](FLOW_VERIFICATION.md) (per-flow evidence), [ISSUE_REGISTER.md](ISSUE_REGISTER.md) (defects, fixes, blockers), [VERIFICATION_LOG.md](VERIFICATION_LOG.md) (every command run and its result).
**Last updated:** 2026-10-29, round 2 (owner decisions on ISSUE-008/010/011/012/020 applied).

> **Evidence rule.** Anything below marked *verified* was reproduced in this session (see VERIFICATION_LOG). Claims taken from older reports (`TASK_01B_*.md`, `reasons.md`, `FEATURE_FLOW_STATUS.md`) are labelled *reported* and are not proof.

---

## 1. Product and users

Internal management ERP for **Ravinarayan PG Guesthouse** (22 rooms / 39 beds, Met City, Jhajjar, Haryana) and its **commercial tiffin (meal delivery) service**, plus a separate public marketing website. Canonical requirements: [PROJECT_REQUIREMENTS.md](PROJECT_REQUIREMENTS.md) (PRD, 16 Oct 2026).

| User | Role code | Typical device |
|---|---|---|
| Owner (2 accounts planned) | `SUPER_ADMIN` | Desktop + phone |
| Manager (1) | `OPERATIONS_MANAGER` | Desktop + phone |
| Delivery boy (1, "Suresh") | `DELIVERY_PERSON` | Android phone (PWA) |
| Legacy, not assignable in UI | `ACCOUNTANT`, `KITCHEN_OPERATIONS` | — |

Task 01B.69 consolidated operations to the three canonical roles. The two legacy roles still exist in [permissions.ts](../apps/erp/src/server/authorization/permissions.ts) so existing accounts keep working, but they can no longer be assigned (ISSUE-012). The Owner should move any legacy account to Manager or Delivery from Staff Administration.

### 1.1 Role → permission matrix (verified from code)

| Permission | SUPER_ADMIN | OPERATIONS_MANAGER | DELIVERY_PERSON | ACCOUNTANT (legacy) | KITCHEN_OPS (legacy) |
|---|:-:|:-:|:-:|:-:|:-:|
| staff.read | ✓ | ✓ | | | |
| staff.create / update / deactivate / assign_role | ✓ | | | | |
| audit.read | ✓ | ✓ | | ✓ | |
| system.manage | ✓ | | | | |
| rooms.read / rooms.manage | ✓ | ✓ | | | |
| residents.read / residents.manage | ✓ | ✓ | | read | |
| finance.read | ✓ | ✓ | | ✓ | |
| **finance.record** (rent charge/payment, deposit, expense, their receipts) | ✓ | **✓** | | ✓ | |
| **finance.manage** (reversals, closings, invoices, tiffin billing/payments, settlement receipts, document archive) | ✓ | ✗ | | ✓ | |
| tiffin.read / tiffin.manage | ✓ | ✓ | | | read |
| kitchen.read / kitchen.manage | ✓ | ✓ | | | ✓ |
| delivery.read / delivery.update | ✓ | ✓ | ✓ | | |
| delivery.manage | ✓ | ✓ | | | |

**Decision (b), 2026-10-29:** the Manager records rent, deposits and expenses (`finance.record`); reversals, closing finalization/reopen and invoice actions stay Owner-only (`finance.manage`). Other existing Manager money paths are unchanged: dine-in/counter orders, driver handover acceptance, and checkout settlement including refunds (settlement authority is open, ISSUE-026). The finance UI hides Owner-only actions via `useHasPermission`; the server remains the control.

Enforcement points: `middleware.ts` (session cookie required for `/api/*` except auth/health; CSRF origin check on every mutating `/api/*` request) → service-layer `requirePermission(actor, perm)` in every service function. UI hiding in `ErpShell.tsx` is cosmetic only.

---

## 2. Architecture

| Component | Location | Tech | Port |
|---|---|---|---|
| ERP | `apps/erp` | Next.js 14 App Router, React 18, Tailwind, Drizzle ORM (schema/migrations) + raw SQL via `AsyncDb`, postgres.js | 3001 |
| Public website | `apps/website` | Next.js 14, framer-motion, three.js; static content, **no ERP/API/DB integration** | 3000 |
| Shared | `packages/brand`, `packages/config` | brand tokens, config | — |
| Database | PostgreSQL 16 | 12 Drizzle migrations `0000`–`0011`, 34 tables (*verified* on fresh PG16) | 5432 |

**Data access.** Services call `getAsyncDb()` ([db.ts](../apps/erp/src/server/database/db.ts)), which returns a postgres.js-backed `AsyncDb` (`query/queryOne/execute/transaction`, `?` placeholders converted to `$n`). Tests inject a SQLite-backed `AsyncDb` (`createAsyncDbFromSqlite`) through `tests/register_paths.js`. **Code paths gated on `tx.isPostgres` (advisory locks, `FOR UPDATE`/`FOR SHARE`) never execute under SQLite tests.**

**Server modules** (`apps/erp/src/server/*`): authentication (password + email OTP, sessions, reset tokens), authorization, audit, rooms, residents (+ settlement), finance (ledger, invoices, GSTIN, daily closing), tiffin (customers, products, subscriptions, billing), kitchen (plans, demand, inventory, recipes, walk-in sales), orders (unified order entry), delivery (tasks, collections, cash custody/handover, offline sync), documents (KYC/receipt storage), notifications (email adapter + in-app), reports, staff, dashboard.

**Data ownership.**
- `financial_transactions` is the single ledger. Every money-moving workflow (rent, deposit, expense, tiffin payment, walk-in/dine-in sale, accepted driver handover, settlement, reversal) writes here inside a transaction guarded by `assertClosingDateNotFinalized`.
- `daily_cashbook_closings` freezes a date per division (`PG`, `TIFFIN`, `COMBINED`); FINALIZED dates reject writes until reopened.
- Delivery cash stays in driver custody (`delivery_tasks.collection_*`, `driver_cash_handovers`) until a manager accepts the handover, which then posts `TIFFIN_PAYMENT` to the ledger.
- Orders live in `orders` + `order_items` (migration 0012). `orders.status` is the order lifecycle (CONFIRMED/COMPLETED/CANCELLED); delivery progress stays on `delivery_tasks`. A delivery order links its task, a dine-in order its ledger sale (CHECK-enforced). Legacy `[ORDER_JSON]` rows are converted by the idempotent backfill; the note is still dual-written for the delivery modal during the transition (ISSUE-035).
- Documents: metadata in `document_attachments`; files on disk under `ERP_STORAGE_DIR` (default `storage/`, git-ignored).

---

## 3. Modules and dependencies

```
auth ─► staff ─► (every module: actor + RBAC + audit)
rooms ─► residents ─► finance (rent/deposit) ─► daily closing
                 └─► kitchen eligibility (resident meals)
tiffin customers/products/subscriptions ─► orders ─► delivery tasks ─► collections ─► handover ─► finance ─► daily closing
kitchen plans ◄─ demand (residents + subscriptions + orders − opt-outs) ─► inventory (BOM deduction)
finance invoices ◄─ tiffin billing / manual invoices; payments allocate to invoices
reports/dashboard ◄─ read-only aggregation of all of the above
```

UI routes: `/login`, `/forgot-password`, `/reset-password`, `/dashboard`, `/rooms`, `/residents`, `/finance`, `/orders`, `/delivery`, `/staff`, `/offline`; `/kitchen` and `/tiffin` pages still exist but are reported to redirect to `/orders` (Task 01B.70). 101 API route handlers under `app/api` — full inventory in FLOW_VERIFICATION.md.

---

## 4. End-to-end business workflows (intended)

1. **Login:** password (bcrypt-12) → 6-digit email OTP (10 min, 3 attempts) → single active session (new login preempts old) → role landing page.
2. **Resident lifecycle:** register → check-in to a bed (capacity + one-active-stay guards) → monthly rent charges/payments, deposit → optional transfer → checkout settlement (dues, deductions, deposit application = no cash, refund = cash out) → stay COMPLETED, bed freed.
3. **Tiffin order to cash:** customer (dedupe by phone) → order (delivery or dine-in) → delivery task auto-assigned/dispatched → driver completes with delivered/undelivered portions + CASH/UPI collection (online or offline queue) → driver declares shift handover → manager accepts (variance justified) → ledger `TIFFIN_PAYMENT`.
4. **Subscriptions & billing:** subscription (pause/resume/cancel) → billing preview → invoice generation (GST or regular, `INV-YYYY-XXXX`) → payment allocation → customer balance.
5. **Kitchen:** daily demand → meal plan DRAFT → CONFIRMED → COMPLETED (actual counts) → BOM inventory deduction; stock receipts/waste/adjustments; walk-in sales post to ledger.
6. **Daily closing:** preview per division → draft → finalize with counted cash (variance needs reason) → date locked → reopen (authorized) for corrections.
7. **Staff admin (Owner):** create staff, assign role, activate/deactivate (sole-Super-Admin guard), reset password/recovery link, audit history.
8. **Documents:** upload KYC/receipt (magic-byte validated, ≤5 MB) → authenticated download → supersede/delete.

---

## 5. Implementation status summary (2026-10-29, round 2)

| Area | Evidence | Open items |
|---|---|---|
| Auth, OTP, sessions, reset | SQLite suites; **browser login for 3 roles** (outbox email) | Real SMTP untested by design; reset UI not browser-tested |
| Staff admin & RBAC | SQLite suites; **live-PG finance permission matrix**; browser 403/UI checks | Legacy accounts to migrate (owner task) |
| Rooms & residents, settlement | SQLite suites; **settlement on live PG**; browser render | ISSUE-026 decision; check-in/transfer UI not browser-tested |
| Finance ledger, invoices, closing | **Live PG: closing locks, money flows (55 checks)**; browser Owner/Manager | — |
| Orders | **Live PG (34 checks)** + browser | ISSUE-034/035/036 |
| Delivery & handover | **Live PG** sync/races/handover; **browser offline flow at 390 px** | Manual assign UI (ISSUE-023); physical-phone PWA check |
| Kitchen & inventory, tiffin subscriptions/billing | SQLite suites only | Live-PG and browser coverage pending |
| Documents | SQLite suites; receipt upload permission on live PG | Upload UI not browser-tested |
| Website | **Production build + browser at 1366/390 px, 30/30** | — |

Safe regression baseline (VL-20): **40 suites pass, 0 fail, 3 skipped by design** (live resources), including 4 live-PostgreSQL suites (122 checks). ERP and website production builds succeed in the sandbox (VL-21). Git: snapshot `7b175c3` on local branch `wip/01b-takeover-snapshot` (not pushed); later work is uncommitted on that branch.

---

## 6. Safe local development and testing

### 6.1 Protected resources — never touch
- `data/erp.db`, `data/erp.db-wal`, `data/erp.db-shm` (and backups in `data/`).
- Neon rehearsal DB `ravi-narayana-erp-phase01b-test`, the Neon `neondb` referenced by `apps/erp/.env.local`, or any remote database.
- Real `.env*` files: never print, copy or commit.

### 6.2 Environment loading (verified)
| Command | Env files loaded | Effective DB |
|---|---|---|
| `npm run dev:erp` / `dev:erp:local` (`next dev`) | `.env.development.local` overrides `.env.local` | local `ravinarayana_erp_local` (127.0.0.1:5432) |
| `npm run build:erp`, `npm run start:erp` (`next build/start`) | `.env.production*`, **`.env.local`** | **remote Neon — DO NOT RUN locally** (ISSUE-005) |
| `npm run db:migrate` (`scripts/migrate.js`) | reads `.env.development.local`, then `.env.local` for unset keys | validated: loopback host + db name containing local/dev/test, else exit 1 |
| `npm run db:seed:local` | `.env.development.local` only, strict local validation | local dev DB (writes) |
| `npm test` / `test:*` in the working tree | none | SQLite `tests/test_erp.db`; but suites `stat` `data/erp.db` and write `tests/dist` — **do not run in the working tree** |

### 6.3 Local services
- Local dev Postgres: `.\scripts\local-db.ps1 start|status|health|logs|migrate` → Docker inside WSL `Ubuntu-22.04`, container `ravinarayana-postgres-local`, volume `ravinarayana_pgdata_local`. WSL stops when idle; the container restarts with it.
- ERP: `.\scripts\start-erp.ps1 [-LocalOnly] [-Migrate]` (refuses if port 3001 busy; migrations only with `-Migrate`).
- Website: `npm run dev:website` (port 3000).

### 6.3a Configuration added or changed in this takeover
| Variable | Purpose |
|---|---|
| `ERP_ADMIN_EMAIL` | **Required** to seed the first administrator (no built-in default). |
| `ERP_ADMIN_PASSWORD` | Required in production (≥12 chars, retired demo password refused). Leave empty locally to get a generated one-time password. |
| `SMTP_USER` | **Required** with `EMAIL_ADAPTER=smtp` (no built-in sender mailbox). `EMAIL_FROM` defaults to it. |
| `EMAIL_ADAPTER=outbox` + `ERP_EMAIL_OUTBOX_DIR` | Development-only mail catcher (OTP/reset emails written as files). Refused in production. |
| `ERP_DEFAULT_DELIVERY_USERNAME` | Optional default driver for auto-assigned orders. |

### 6.3b Bootstrap (first administrator, local)
1. Put `ERP_ADMIN_EMAIL=<your address>` (and optionally `ERP_ADMIN_USERNAME`) in `apps/erp/.env.development.local`; leave `ERP_ADMIN_PASSWORD` unset.
2. `npx tsc -p tests/tsconfig.json` then `npm run db:seed:local` (local dev DB only; refuses anything else).
3. The generated password is shown once on the terminal (or written to `~/.ravinarayan-erp/initial-admin-password.txt`, owner-only, if output is not a terminal). Sign in, change it, delete that file.
Existing databases with staff are never re-seeded.

### 6.3c Orders rollout on an existing local database
1. `npm run db:migrate` (applies 0012; local targets only).
2. `npx tsc -p tests/tsconfig.json`, then `node -r ./tests/register_paths.js scripts/backfill-orders.js --dry-run` to see pending legacy rows, then run it without `--dry-run`. Re-running is a no-op. For any shared or production database the owner must run these steps deliberately; they were verified only on disposable databases.

### 6.4 Running tests safely (the only approved way)
```powershell
# All SQLite-backed suites in an isolated copy (no data/, no real .env, no credentials in env):
.\scripts\run-sandboxed-tests.ps1
# Selected suites:
.\scripts\run-sandboxed-tests.ps1 -Suites finance,task01b_53_closing
```
Live PostgreSQL verification uses a **disposable** container (tmpfs, loopback port 55432). Keep the attached `docker run` process alive while testing (WSL shuts down idle VMs):
```powershell
wsl -d Ubuntu-22.04 -- bash -c "docker run --rm --name rn_erp_verify_pg -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_USER=rn_verify -e POSTGRES_PASSWORD=rn_verify_local -e POSTGRES_DB=rn_erp_verify_test postgres:16-alpine"
# in another terminal:
.\scripts\run-sandboxed-tests.ps1 -Suites pg_closing_locks -PgVerifyUrl postgresql://rn_verify:rn_verify_local@127.0.0.1:55432/rn_erp_verify_test
```
Every `pg_*` suite (`pg_closing_locks`, `pg_delivery_sync`, `pg_money_flows`, `pg_orders`) refuses any target that is not loopback or whose database name lacks `verify`. These credentials are throwaway values for an ephemeral container, not secrets.

Browser verification (VL-22/23) used scratch scripts outside the repo: a sandbox `next dev` on 127.0.0.1:3101 against a fresh `rn_erp_verify_e2e_test`, `EMAIL_ADAPTER=outbox`, and headless Edge over the DevTools protocol. Never point browser tests at the dev database or :3001.

Never run in the working tree: `npm test`, `test:task74` (seeds the local dev DB), `test:task75` (real SMTP), `test:postgres:live` (drops the `public` schema of its target), `seed:demo`.

---

## 7. Execution plan

Batches 1–8 are done (see [ISSUE_REGISTER.md](ISSUE_REGISTER.md) §Execution plan). Next:
1. Manual assign/reassign UI on `/delivery` (ISSUE-023).
2. Switch the delivery modal to `order_items` and stop writing `[ORDER_JSON]` (ISSUE-035); route `/api/kitchen/walkin-sale` through orders (ISSUE-034).
3. Owner decisions: settlement authority (ISSUE-026), order edit/cancel rules (ISSUE-036).
4. Live-PG coverage for kitchen inventory, tiffin billing generation and room/resident concurrency; browser coverage for the flows listed as not yet browser-tested in FLOW_VERIFICATION.
5. Before any push: redact the Neon hostname in `reasons.md` and old literals in history (ISSUE-011 note).

## 8. Caching and data freshness (round 4, 2026-10-30)

**Mechanisms** (no new dependencies):
1. Client data cache `lib/cache/erpDataCache.ts` (`useErpQuery`): in-memory per tab, stale-while-revalidate, in-flight de-duplication, tag invalidation. **Scoped to the signed-in user** (`setCacheOwner` in `ErpShell`; switching account clears it; logout clears it). Optional `pollIntervalMs` polls only while the tab is visible and is shared across instances.
2. Next.js client router cache, `experimental.staleTimes { dynamic: 120, static: 120 }`: server-rendered pages (dashboard, staff shell) are reused for up to 2 min. `ErpShell` calls `router.refresh()` whenever an invalidation touches `dashboard`/`staff` (or a full clear), which purges it.
3. Server caches: dashboard aggregates (15 s, keyed by **role** + division + date range) and notification feeds (30 s, keyed per user). Both are cleared by the **commit-time business-write signal** in `server/database/changeSignals.ts` (any committed INSERT/UPDATE/DELETE outside auth/audit tables).
Nothing auth-related is cached: OTP challenges, verification results and sessions always hit the database; every API request is still authorised server-side.

| Data | Where | Scope | Fresh for | Invalidated by |
|---|---|---|---|---|
| Rooms, Residents lists | client cache | user | 5 min | room/resident/check-in/out/transfer actions (`rooms`, `residents`) |
| Finance bundle (cashbook, transactions) | client cache | user | 60 s | finance actions, handover acceptance, orders (`finance`) |
| Staff directory | client cache | user (Owner only) | 5 min | every staff action (`staff`) |
| Orders board | client cache | user + filters | 20 s, polled while visible | new order, delivery completion, dispatch (`orders`) |
| Delivery tasks, custody, pending handovers | client cache | user + filters | 20 s, polled while visible | completion, dispatch, declare, accept, new order (`delivery`, `handover`) |
| Tiffin customers / products / subscriptions | client cache | user | 30 s (unchanged) | their own actions |
| Notifications | client cache (shared by both bells) + server 30 s | user | 30 s poll | mark read; any business write (server) |
| Dashboard | router cache + server 15 s | role | 2 min client / 15 s server | any `dashboard` invalidation (router refresh); any committed business write (server) |

Changes made by *other* users appear on the next poll (orders/delivery 20 s), when the freshness window lapses, on tab focus (orders/delivery), or via the page's refresh button.

**Dev-mode note:** `next dev` compiles each route on first request (3–4 s per section on a cold cache, VL-34). `scripts/start-erp.ps1` runs `scripts/warm-erp-routes.ps1` in the background; since round 5 it really compiles the protected pages, the data APIs they call and the sign-in routes (it sends a throwaway cookie that passes the middleware but matches no session) and only one copy runs per URL. Your running :3001 server picks this up the next time it is started with `start-erp.ps1`. In dev every first visit makes two RSC requests (Next 14.2 dev behaviour, ISSUE-049). Production builds have no compile step and prefetch nav targets (first visits 89–172 ms measured in the sandbox build).

**Measurement tooling:** `ERP_DB_METRICS=1` (dev only) enables per-statement counts/timings; read them at `/api/dev/db-metrics` (`?reset=1` to clear). Disabled in production and by default.

**Local accounts (2026-10-30, round 5):** `rishabh_manager` (Rishabh Manager, OPERATIONS_MANAGER, rishabh3725@gmail.com) and `zevats_delivery` (Zevats Delivery, DELIVERY_PERSON, zevats@gmail.com) exist in the local DB only, created through `createStaffUser` with the owner-supplied password (not recorded anywhere). Both sign in with password + emailed OTP. Role isolation verified (VL-36). Management pages /rooms, /residents, /finance now have a server-side permission guard (`server/authorization/pageGuard.ts`).

## 9. Round 6 and 7 summary (2026-10-30)

**Performance (round 6)** — see [PERFORMANCE_MATRIX.md](PERFORMANCE_MATRIX.md).
- Dev route eviction is disabled (`onDemandEntries`), so routes no longer recompile after short pauses.
- Local DB connections are kept for 30 minutes.
- The warm-up compiles every page and API route (112) and runs as a single instance.
- Clicks give instant navigation feedback.
- The client cache cancels stale requests.
- Sign-out takes about 0.9 s (API 0.18 s).
- Role redirects happen before rendering.

**Order → delivery workflow (round 7)** — see [ORDER_DELIVERY_WORKFLOW.md](ORDER_DELIVERY_WORKFLOW.md).
- Menu-priced orders.
- Per-item delivery outcome.
- Amount due from delivered quantities.
- Capped, additive balance collection.
- Live updates over SSE (`/api/events`).

**Waiting on the Owner:**
1. Approve `npm run db:migrate` (migration 0012) and `scripts/backfill-orders.js` on the local DB.
2. Approve restoring the 14-item menu with the existing seeder.
3. Create Suresh's account, or confirm that Zevats Delivery stands in, and set `ERP_DEFAULT_DELIVERY_USERNAME`.
4. Choose the menu name spelling.
5. Decide whether to support a price override, quoted party orders, and order edit/cancel.

**Daily start:** use `scripts/start-erp.ps1`. Its background warm-up takes about 4 minutes after a start; the first section opened during that window may wait for a compile. Avoid editing `next.config.mjs` while the server runs: a config change stopped the dev server once (VL-47).

