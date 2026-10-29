# Ravinarayan ERP — Project Handoff

**Purpose:** single source of truth for architecture, scope, workflows, current state and safe setup.
**Companion documents:** [FLOW_VERIFICATION.md](FLOW_VERIFICATION.md) (per-flow evidence), [ISSUE_REGISTER.md](ISSUE_REGISTER.md) (defects, fixes, blockers), [VERIFICATION_LOG.md](VERIFICATION_LOG.md) (every command run and its result).
**Last updated:** 2026-10-29 (Claude Code takeover session).

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

Task 01B.69 consolidated operations to the three canonical roles. The two legacy roles still exist in [permissions.ts](../apps/erp/src/server/authorization/permissions.ts) and are still accepted by the staff API (see ISSUE-012).

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
| **finance.manage** | ✓ | **✗** | | ✓ | |
| tiffin.read / tiffin.manage | ✓ | ✓ | | | read |
| kitchen.read / kitchen.manage | ✓ | ✓ | | | ✓ |
| delivery.read / delivery.update | ✓ | ✓ | ✓ | | |
| delivery.manage | ✓ | ✓ | | | |

**Conflict:** PRD §2.2 says the Manager records rent charges, rent payments, deposits and expenses, but `OPERATIONS_MANAGER` lacks `finance.manage`. With `ACCOUNTANT` retired, only the Owner can post money movements or finalize closings. This is an open product decision (ISSUE-010).

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
- Orders have no table of their own: the order payload lives in `delivery_tasks.delivery_notes` as `[ORDER_JSON:{...}]` (ISSUE-008).
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

## 5. Implementation status summary (2026-10-29)

| Area | Code present | Automated evidence | Notes |
|---|---|---|---|
| Auth, OTP, sessions, reset | ✓ | SQLite suites pass (otp_auth_flow, auth_hardening partially blocked) | Real SMTP untested by design |
| Staff admin & RBAC | ✓ | rbac, task56 pass (SQLite) | Legacy roles still assignable via API |
| Rooms & residents, settlement, transfer | ✓ | rooms_residents, task52, task54 pass (SQLite) | No PG concurrency test yet |
| Finance ledger, invoices, GSTIN | ✓ | finance, invoicing, task50/51/64 pass (SQLite) | Manager cannot post money (ISSUE-010) |
| Daily closing & locks | ✓ | task53/61 pass (SQLite) **+ pg_closing_locks 14/14 on live PG** | Deadlock found & fixed (ISSUE-001) |
| Tiffin, orders, delivery, handover | ✓ | tiffin, delivery, task58/69/70/71 pass (SQLite) **+ pg_delivery_sync 19/19 on live PG** | Offline completion now wired (ISSUE-006) and applied exactly once (ISSUE-021); default driver configurable (ISSUE-009); no manual assign UI (ISSUE-023) |
| Kitchen & inventory | ✓ | kitchen, kitchen_inventory pass (SQLite) | |
| Documents | ✓ | task57 pass (SQLite) | |
| PWA / mobile shell | ✓ | task66/67/68 pass (static source checks) | Phone/PWA behaviour not yet exercised |
| Website | ✓ | none | Not yet built/inspected in this session |

Safe regression baseline (2026-10-29, VL-14): **38 suites pass, 0 fail, 3 skipped** (live resources). The ERP production build succeeds in the sandbox (VL-15). No browser-level end-to-end verification has been performed yet. Git: all work from Tasks 01B.49–75 is **uncommitted** on `master` (last commit `a1c7755`, 2026-10-22).

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
`pg_closing_locks` refuses any target that is not loopback or whose database name lacks `verify`. These credentials are throwaway values for an ephemeral container, not secrets.

Never run in the working tree: `npm test`, `test:task74` (seeds the local dev DB), `test:task75` (real SMTP), `test:postgres:live` (drops the `public` schema of its target), `seed:demo`.

---

## 7. Execution plan

See [ISSUE_REGISTER.md](ISSUE_REGISTER.md) §"Execution plan" for the prioritized batches and acceptance criteria. Summary:
1. **Batch 1 (done):** closing lock deadlock + swallowed lock errors, verified on live PG.
2. **Batch 2 (done):** test-harness reliability and DB-target safety.
3. **Batch 3 (done, browser check pending):** offline delivery completion + duplicate-completion race.
4. **Batch 4 (partly done):** default driver configurable; legacy roles and `env.ts` defaults await owner decisions.
5. **Batch 5 (next):** PG integration coverage for every money-moving workflow (settlement, handover, tiffin payment, invoice allocation, reversal); SQLite→PG utility must require an explicit source (ISSUE-022).
6. **Batch 6:** structured order persistence (replace `[ORDER_JSON]`, ISSUE-008/024), Manager finance permission (ISSUE-010) — pending product decisions.
7. **Batch 7:** manual assign UI (ISSUE-023); browser E2E of the core flows against the local dev stack; website build check; documentation reconciliation.

New configuration introduced this session: `ERP_DEFAULT_DELIVERY_USERNAME` (optional; username of the delivery account that receives auto-assigned orders).
