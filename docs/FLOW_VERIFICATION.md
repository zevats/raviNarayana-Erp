# Flow Verification

Flow-by-flow inventory with the evidence actually obtained. **A flow is only `VERIFIED` when it was exercised end to end (UI → API → service → PostgreSQL → response/UI) or, for backend-only rules, against live PostgreSQL.**

Status values:
- `VERIFIED-BROWSER`: exercised in headless Edge against an isolated ERP server (sandbox build, disposable PostgreSQL, outbox email) — VL-22/VL-23.
- `VERIFIED-PG`: business rule exercised against live PostgreSQL 16 (disposable local DB).
- `SQLITE-ONLY`: service logic covered by a passing legacy suite on the SQLite double. Postgres-specific branches, route handlers and UI are **not** exercised.
- `FAILED`: a check demonstrates the flow is broken.
- `BLOCKED`: cannot be verified safely; the reason is given.
- `NOT VERIFIED`: code exists, no meaningful evidence yet.
- `NOT IMPLEMENTED`.

Common to every API flow: middleware requires the session cookie (except auth/health) and a same-origin CSRF check on POST/PUT/PATCH/DELETE; the service calls `requirePermission`; mutations write `audit_logs` with actor id/username. Browser-level verification: the flows marked VERIFIED-BROWSER (VL-22, VL-23). Not yet browser-tested: kitchen, tiffin customers/subscriptions/billing UI, invoice UI, check-in/transfer/check-out UI, document upload UI, password reset UI, staff role change/deactivation UI, handover declare/accept UI.

Suites referenced are in `tests/`; results come from VL-10 in [VERIFICATION_LOG.md](VERIFICATION_LOG.md).

---

## A. Authentication & sessions

| ID | Flow | Role | UI → API | Service | Writes / tx | Evidence | Status |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Password login → OTP challenge | any | `/login` → `POST /api/auth/login` | `auth.ts` login/challenge | `auth_challenges`, `login_attempts` | otp_auth_flow, auth_hardening, **browser E2E (3 roles)** | **VERIFIED-BROWSER** (outbox email) |
| AUTH-02 | OTP verify → session (preempts old session) | any | `POST /api/auth/otp/verify` | `verifyOtpChallenge` | `sessions`, `session_preemptions` | otp_auth_flow, **browser E2E** | **VERIFIED-BROWSER** (preemption SQLite-only) |
| AUTH-03 | OTP resend / attempt limit (3) / expiry (10 min) | any | `POST /api/auth/otp/resend` | `resendOtpChallenge` | `auth_challenges` | otp_auth_flow | SQLITE-ONLY |
| AUTH-04 | Brute-force throttling (IP / account+IP) | any | login | `auth.ts` rate limiter | `login_attempts` | auth_hardening (now runs fully) | SQLITE-ONLY |
| AUTH-05 | Forgot password → reset link (generic response) | any | `/forgot-password` → `POST /api/auth/forgot-password` | `initiatePasswordReset` | `password_reset_tokens` | task56 | SQLITE-ONLY |
| AUTH-06 | Reset password (single use, revokes sessions) | any | `/reset-password` → `POST /api/auth/reset-password` | `completePasswordReset` | tokens, `staff_users`, `sessions` | task56 | SQLITE-ONLY |
| AUTH-07 | Logout / session validation / `me` | any | `POST /api/auth/logout`, `GET /api/auth/me` | `destroySession`, `validateSessionDetailed` | `sessions` | auth_hardening | SQLITE-ONLY |
| AUTH-08 | Real SMTP OTP delivery | any | — | `emailAdapter` (Gmail SMTP) | — | task75 needs real SMTP | BLOCKED (external service) |

## B. Staff administration & RBAC

| ID | Flow | Role | API | Service | Evidence | Status |
|---|---|---|---|---|---|---|
| STAFF-01 | List/search staff, KPI stats | Owner, Manager (read) | `GET /api/staff` | `staffService.listStaffUsers` | task56 | SQLITE-ONLY |
| STAFF-02 | Create staff (canonical roles only) | Owner | `POST /api/staff` | `createStaffUser` + `isAssignableRole` | task56, rbac, **browser (dialog), API 403 for Manager** | **VERIFIED-BROWSER** (UI) / SQLITE-ONLY (service) |
| STAFF-03 | Change role (canonical only; sole Super Admin guard; legacy accounts movable) | Owner | `PUT /api/staff/[id]/role` | `updateStaffRole` | task56, rbac | SQLITE-ONLY |
| STAFF-04 | Activate/deactivate (revokes sessions; sole SA guard) | Owner | `PUT /api/staff/[id]/status` | `setStaffActiveStatus` | task56 | SQLITE-ONLY |
| STAFF-05 | Admin password reset / recovery link | Owner | `POST /api/staff/[id]/reset-password`, `/recovery` | staffService | task56 | SQLITE-ONLY |
| STAFF-06 | Staff audit history | Owner | `GET /api/staff/[id]/history` | `getStaffAuditHistory` | task56 | SQLITE-ONLY |
| RBAC-01 | Server rejects wrong-role requests on every service | all | all | `requirePermission` | rbac, **pg_money_flows §H (19 finance checks)**, **browser (Manager/Driver 403s)** | **VERIFIED-PG** for finance; SQLITE-ONLY elsewhere |
| RBAC-02 | Role-aware navigation / routing (Driver → /delivery) | all | `ErpShell.tsx`, dashboard redirect | — | task67/68, **browser** | **VERIFIED-BROWSER + real app** (VL-36): Driver redirected from /dashboard, /rooms, /residents, /finance, /staff; Manager denied all Owner-only actions with the new local profiles |

## C. Rooms & residents

| ID | Flow | Role | API | Service | Writes / tx | Evidence | Status |
|---|---|---|---|---|---|---|---|
| ROOM-01 | Room list / filters / occupancy | Owner, Manager | `GET /api/rooms` | `roomService.listRooms` | — | rooms_residents, task54, **browser render** | **VERIFIED-BROWSER** (render) |
| ROOM-02 | Create/update room (unique nocase number, capacity>0) | Owner, Manager | `POST /api/rooms`, `PATCH /api/rooms/[id]` | `createRoom`, `updateRoom` | `rooms` | task54 | SQLITE-ONLY |
| ROOM-03 | Deactivate/delete guarded by occupancy/history | Owner, Manager | `PATCH`/`DELETE /api/rooms/[id]` | `setRoomActiveStatus`, `deleteRoom` | `rooms` | task54 | SQLITE-ONLY |
| RES-01 | Register resident (unique phone) | Owner, Manager | `POST /api/residents` | `registerResident` | `residents` | rooms_residents | SQLITE-ONLY |
| RES-02 | Check-in (capacity, single active stay) | Owner, Manager | `POST /api/residents/check-in` | `assignResidentToRoom` | `resident_stays` (tx) | rooms_residents, task54 | SQLITE-ONLY; PG row locks untested |
| RES-03 | Room transfer (atomic) | Owner, Manager | `POST /api/residents/transfer` | `transferResidentRoom` | stays (tx) | task54 | SQLITE-ONLY |
| RES-04 | Update resident | Owner, Manager | `PATCH /api/residents/[id]` | `updateResident` | `residents` | rooms_residents | SQLITE-ONLY |
| RES-05 | Checkout preview | Owner, Manager | `GET /api/residents/check-out/preview` | `previewResidentSettlement` | — | task52 | SQLITE-ONLY |
| RES-06 | Checkout settlement (deductions, deposit application, refund) | Owner, Manager (current rule, ISSUE-026) | `POST /api/residents/check-out` | `residentSettlementService` | stays, ledger (tx, closing lock) | task52, task61, **pg_money_flows §C** | **VERIFIED-PG** (single settlement under concurrency, refund once, non-cash application) |
| RES-07 | Settlement history | Owner, Manager | `GET /api/residents/[id]/settlement` | `listResidentSettlements` | — | task52 | SQLITE-ONLY |
| DOC-01 | Upload KYC/receipt (magic bytes, ≤5 MB) | Owner, Manager | `POST /api/documents` | `documentService` | `document_attachments`, disk | task57 | SQLITE-ONLY |
| DOC-02 | Download / view / delete document | Owner, Manager | `GET /api/documents/[id]/download`, `DELETE /api/documents/[id]` | documentService | — | task57 | SQLITE-ONLY |

## D. Finance, invoicing & closing

| ID | Flow | Role | API | Service | Writes / tx | Evidence | Status |
|---|---|---|---|---|---|---|---|
| FIN-01 | Rent charge | Owner, Manager (`finance.record`) | `POST /api/finance/transactions` | `recordRentCharge` | ledger (tx + closing + idempotency locks) | finance, **pg_money_flows §H** | **VERIFIED-PG** |
| FIN-02 | Rent payment (overpayment guard, idempotency) | Owner, Manager | same | `recordRentPayment` | ledger (resident lock) | finance, task61, **pg_money_flows §A** | **VERIFIED-PG** (race fixed, ISSUE-027) |
| FIN-03 | Security deposit | Owner, Manager | same | `recordSecurityDeposit` | ledger | finance, **pg_money_flows §C, §G (rollback)** | **VERIFIED-PG** |
| FIN-04 | Expense (division by category; receipt attachment) | Owner, Manager | same | `recordExpense` | ledger (tx + closing lock) | finance, pg_closing_locks, **pg_money_flows §H**, **browser (Owner + Manager)** | **VERIFIED-PG + BROWSER** |
| FIN-05 | Reversal (business-date, cross-period) | Owner only | same | `reverseTransaction` | ledger (status-guarded) | finance, task63, **pg_money_flows §B**, **browser (Manager 403, button hidden)** | **VERIFIED-PG** (double reversal fixed, ISSUE-028) |
| FIN-06 | Cashbook summary / division views | Owner, Manager | `GET /api/finance/cashbook`, `/api/reports/business` | `getCashbookSummary`, reporting | — | task55, task61 | SQLITE-ONLY |
| FIN-07 | Resident financial summary | Owner, Manager | `GET /api/finance/residents/[id]` | `getResidentFinancialSummary` | — | finance | SQLITE-ONLY |
| INV-01 | Create draft invoice (GST/regular, GSTIN validation) | Owner | `POST /api/finance/invoices` | `invoiceService` | `invoices` | invoicing, task50, task64 | SQLITE-ONLY |
| INV-02 | Issue invoice (sequential `INV-YYYY-XXXX`) | Owner | `POST /api/finance/invoices/[id]/issue` | `issueInvoice` | invoices (tx, closing lock) | task50, **pg_money_flows §F** | **VERIFIED-PG** (5 concurrent issuances, unique numbers) |
| INV-03 | Allocate payment to invoice | Owner | `POST /api/finance/invoices/[id]/allocate` | `allocatePaymentToInvoice` | invoices + ledger | task51, **pg_money_flows §F** | **VERIFIED-PG** (no over-allocation) |
| INV-04 | Cancel invoice (closing lock on issue date) | Owner | `POST /api/finance/invoices/[id]/cancel` | `cancelInvoice` | invoices | task63, **pg_money_flows §F, §H** | **VERIFIED-PG** (paid not cancellable, Manager 403, no re-issue) |
| CLS-01 | Closing preview per division | Owner, Manager | `GET /api/finance/closing/preview` | `previewDailyClosing` | — | task53 | SQLITE-ONLY |
| CLS-02 | Save closing draft | Owner | `POST /api/finance/closing` | `saveDailyClosingDraft` | closings | task53 | SQLITE-ONLY |
| CLS-03 | Finalize closing (variance reason, snapshot, lock) | Owner | `POST /api/finance/closing` | `finalizeDailyClosing` | closings (tx, X advisory lock, FOR UPDATE) | task53, task61, **pg_closing_locks** | **VERIFIED-PG** (no deadlock, snapshot includes in-flight writes, late writes rejected) |
| CLS-04 | Reopen closing | Owner | `POST /api/finance/closing/[id]/reopen` | `reopenDailyClosing` | closings | task53, **pg_money_flows §H** | **VERIFIED-PG** (Owner allowed, Manager 403) |
| CLS-05 | Concurrent writers vs finalization | system | — | lock helpers | — | pg_closing_locks §1, §4 | **VERIFIED-PG** |

## E. Tiffin, orders & kitchen

| ID | Flow | Role | API | Service | Evidence | Status |
|---|---|---|---|---|---|---|
| TIF-01 | Customer directory CRUD, search, status | Owner, Manager | `/api/tiffin/customers*` | tiffinService | tiffin | SQLITE-ONLY |
| TIF-02 | Product catalog CRUD / seed defaults / status | Owner, Manager | `/api/tiffin/products*` | tiffinService | tiffin | SQLITE-ONLY |
| TIF-03 | Subscription create / pause / resume / cancel | Owner, Manager | `/api/tiffin/subscriptions*` | tiffinService | tiffin | SQLITE-ONLY |
| TIF-04 | Billing preview → invoice generation | Owner (finance.manage) | `/api/tiffin/billing/preview`, `/generate` | tiffinBillingService | tiffin | SQLITE-ONLY |
| TIF-05 | Record tiffin payment | Owner | `POST /api/tiffin/payments` | `recordTiffinPayment` | tiffin, task61, **pg_money_flows §E** | **VERIFIED-PG** (idempotent under concurrency, closed-date refusal) |
| TIF-06 | Prepaid billing exceptions | Owner | `/api/tiffin/billing/exceptions` | tiffinBillingService | tiffin | SQLITE-ONLY |
| ORD-01 | New delivery order → orders/order_items + task, auto-assigned & dispatched | Owner, Manager | `/orders` → `POST /api/orders` | `createUnifiedOrder` | task70, task71, **pg_orders**, **browser** | **VERIFIED-PG + BROWSER** (atomic, idempotent) |
| ORD-02 | New dine-in order → ledger sale + order (closing lock) | Owner, Manager | `POST /api/orders` | `createUnifiedOrder` | task71, **pg_orders §4** | **VERIFIED-PG** |
| ORD-03 | Duplicate-phone customer prevention | Owner, Manager | `POST /api/orders` | orderService | task71 | SQLITE-ONLY |
| ORD-04 | Customer order history / repeat order | Owner, Manager | `GET /api/orders/history` | `getCustomerOrderHistory` | task70, **pg_orders §6** | **VERIFIED-PG** |
| ORD-05 | Edit / cancel an order | — | — | — | — | NOT IMPLEMENTED (ISSUE-036, decision needed) |
| KIT-01 | Daily demand calculation | Owner, Manager | `GET /api/kitchen/demand` | `calculateDailyKitchenDemand` | kitchen | SQLITE-ONLY |
| KIT-02 | Meal plan create → confirm → complete; adjust; refresh; reconcile | Owner, Manager | `/api/kitchen/plans*` | kitchenService | kitchen | SQLITE-ONLY |
| KIT-03 | Resident eligibility / opt-outs | Owner, Manager | `GET /api/kitchen/eligibility` | kitchenService | kitchen | SQLITE-ONLY |
| KIT-04 | Prep sheet | Owner, Manager | `GET /api/kitchen/prep-sheet` | kitchenService | kitchen | SQLITE-ONLY |
| KIT-05 | Inventory materials, receipts, waste, adjustments, movements | Owner, Manager | `/api/kitchen/inventory/*` | kitchenInventoryService | kitchen_inventory | SQLITE-ONLY |
| KIT-06 | Recipes (BOM) + consumption preview/confirm/reverse | Owner, Manager | `/api/kitchen/recipes*`, `/consumption/*` | kitchenInventoryService | kitchen_inventory | SQLITE-ONLY |
| KIT-07 | Walk-in sale → ledger | Owner, Manager | `/api/kitchen/walkin-sale` | `recordWalkInSale` | task69 | SQLITE-ONLY |

## F. Delivery & cash custody

| ID | Flow | Role | API | Service | Evidence | Status |
|---|---|---|---|---|---|---|
| DEL-01 | Task list / summary / staff list | Owner, Manager, Driver (own tasks) | `GET /api/delivery/tasks`, `/summary`, `/staff` | deliveryService | delivery, **browser (Driver, 390 px)** | **VERIFIED-BROWSER** |
| DEL-02 | Generate resident tasks from confirmed plan | Owner, Manager | `POST /api/delivery/tasks/generate` | `generateDeliveryTasks` | delivery | SQLITE-ONLY |
| DEL-03 | Assign / batch assign / dispatch / batch dispatch | Owner, Manager | `/assign`, `/batch-assign`, `/dispatch`, `/batch-dispatch` | deliveryService | delivery | SQLITE-ONLY (API only: no assign UI, ISSUE-023) |
| DEL-04 | Complete delivery (portions, shortfall reason, CASH/UPI, idempotency, per-line delivered qty) | Driver, Manager | `POST /api/delivery/tasks/[id]/deliver` | `completeDeliveryTask` | delivery, task70/71, **pg_delivery_sync §3**, **pg_orders §5**, **browser** | **VERIFIED-PG + BROWSER** |
| DEL-05 | Exception / retry | Driver, Manager | `/exception`, `/retry`; UI: 0 delivered + reason | deliveryService | delivery, **pg_delivery_sync §5** | Zero-delivered → EXCEPTION **VERIFIED-PG**; `/exception` and `/retry` have no UI (API only) |
| DEL-06 | Offline completion queued and synced | Driver | modal → `offlineQueue.ts` → `ErpShell` auto-replay → `POST /api/delivery/sync` | `syncDeliveryActions` | task66, **pg_delivery_sync**, **browser (offline emulation)** | **VERIFIED-PG + BROWSER** (not yet on a physical phone/installed PWA) |
| DEL-07 | Driver declares shift handover | Driver | `POST /api/delivery/handover/declare` | `createCashHandoverDeclaration` | task58 | SQLITE-ONLY |
| DEL-08 | Manager accepts handover → ledger TIFFIN_PAYMENT (closing lock, row lock) | Owner, Manager | `POST /api/delivery/handover/[id]/accept` | `acceptCashHandover` | task58, task63, **pg_money_flows §D** | **VERIFIED-PG** (accepted once, clean error for loser, closed-date refusal) |
| DEL-09 | Fleet / driver custody summary | Owner, Manager, Driver | `GET /api/delivery/handover?summary=true` | route + deliveryService | task70 | SQLITE-ONLY |

## G. Reporting, notifications, platform

| ID | Flow | Role | API | Evidence | Status |
|---|---|---|---|---|---|
| RPT-01 | Dashboard KPIs, revenue chart | Owner, Manager | dashboardService | integration_audit, task63, **browser render** | **VERIFIED-BROWSER** (render; figures SQLite-only) |
| RPT-02 | Executive CSV export (formula-injection safe) | Owner, Manager | `GET /api/reports/executive` | task55 | SQLITE-ONLY |
| RPT-03 | Business division report | Owner, Manager | `GET /api/reports/business` | task55 | SQLITE-ONLY |
| NOT-01 | Notification feed + read state | all | `GET/POST /api/notifications` | async_bridge (idempotent read) | SQLITE-ONLY |
| PLT-01 | Health check | public | `GET /api/health` | postgresql_phase01 (now self-contained, passes) | SQLITE-ONLY |
| PLT-02 | PWA manifest, service worker (no API caching), `/offline` page | all | static | task66 (other assertions pass) | SQLITE-ONLY (static checks) |
| PLT-03 | Migrations 0000–0012 apply to empty PG16 and forward on existing | ops | `scripts/migrate.js` | VL-07, VL-19 | **VERIFIED-PG** (13 migrations, 36 tables) |
| PLT-04 | Migration target validator blocks remote/protected DBs | ops | `scripts/migrate.js` | task73 | SQLITE-ONLY (pure function) |
| PLT-05 | Test/seed target validator (`validatePostgresTargetSafety`) default-deny | ops | `pgIntegration.ts` | postgresql_integration_and_readiness | Pure function, verified (ISSUE-003) |
| PLT-07 | Legacy order backfill (idempotent, source rows untouched) | ops | `scripts/backfill-orders.js` | pg_orders §6, VL-19 | **VERIFIED-PG** |
| PLT-08 | Admin bootstrap (configured email, generated one-time password) | ops | `scripts/seed-local-admin.js` | auth_hardening, E2E fixture | Service path VERIFIED-PG; CLI one-time display not exercised against the dev DB |
| PLT-06 | ERP production build | ops | `next build` (sandbox, no env) | VL-21 | Builds (exit 0; pre-existing warning ISSUE-033) |
| WEB-01 | Public website pages (home, rooms, tiffin-service, about, contact, robots, sitemap) | public | `apps/website` | VL-23 | **VERIFIED-BROWSER** (production build, desktop + phone, 30/30 after CSP fix) |

## H. Performance and caching (round 4)

| ID | Flow | Evidence | Status |
|---|---|---|---|
| PERF-01 | Return visit to any section reuses cached data (0 API, 0 DB queries) — Owner, Manager | VL-27, VL-28 | **VERIFIED-BROWSER** (dev + production build) |
| PERF-02 | First visit to a section | Prod build 89–172 ms (VL-28, sandbox); real app dev after warm-up 0.43–1.04 s, cold 3.0–4.4 s (VL-34) | **VERIFIED-BROWSER** (production in sandbox; dev on the real app) |
| PERF-03 | OTP submit → dashboard ready | real app dev 0.99–1.28 s (verify API 170–207 ms, handler 36–60 ms); cold 14.1 s (VL-34/35). Gmail delivery time not measured | **VERIFIED-BROWSER** (dev, outbox email) |
| PERF-04 | Mutation → next visit shows fresh data (orders list + dashboard) | VL-29, 3/3 runs | **VERIFIED-BROWSER** |
| PERF-05 | Cache never crosses accounts; auth data never cached | client_cache_and_signals 22/22; code review | **VERIFIED** (unit) |
| PERF-06 | Live data polling: 20 s, visible tab only, one poll for duplicate components | code + VL-27 request counts | VERIFIED (static + measured counts) |
| PERF-07 | Dashboard load computes the notification feed once (page + bell share it) | VL-35 (37 → 30 queries), notifications test 3.4 | **VERIFIED** (real app + unit) |
| PERF-08 | Dev warm-up compiles protected pages, data APIs and sign-in routes; one instance at a time | VL-34 | **VERIFIED** (real app) |
| AUTH-10 | Login/OTP forms cannot leak credentials before hydration | SSR HTML check + server log (VL-31) | **VERIFIED** |
| AUTH-11 | Auth with DB down → 503 + clear message | auth_verify 35/35 (VL-31) | **VERIFIED-BROWSER** |

## I. Order → delivery workflow (round 7)

| ID | Flow | Evidence | Status |
|---|---|---|---|
| ORD-10 | Create a delivery order for a new customer; menu prices applied on the server; auto-assigned to the default delivery account | VL-48 §1, VL-49 | **VERIFIED-PG + BROWSER** (sandbox) |
| ORD-11 | Existing customer: history and reuse with changed quantities, history unchanged | VL-48 §2, VL-49 | **VERIFIED-PG + BROWSER** |
| ORD-12 | Dine-in never enters Delivery | VL-48 §3, VL-49 | **VERIFIED-PG + BROWSER** |
| ORD-13 | Duplicate submit or retry → one order (draft idempotency key) | VL-49 | **VERIFIED-BROWSER** |
| DEL-20 | Per-item delivered / not-delivered outcome with reason; validation | VL-48 §4/§6, VL-49 | **VERIFIED-PG + BROWSER** |
| DEL-21 | Amount due = delivered × saved prices; collected 0…due; balance | VL-48 §6, VL-49 | **VERIFIED-PG + BROWSER** |
| DEL-22 | Collect balance later (additive, locked, same method, capped) | VL-48 §6, VL-49 | **VERIFIED-PG + BROWSER** |
| DEL-23 | Not delivered: reason, nothing collectable, idempotent, offline replay | VL-48 §8/§9, VL-49 | **VERIFIED-PG + BROWSER** |
| LIVE-01 | Orders, deliveries and payments appear in other open browsers without a reload (SSE, polling fallback) | VL-49 (≤2 s on the phone, 0.6–0.8 s on Orders) | **VERIFIED-BROWSER** (single server process) |
| ORD-L | The same flows on your local DB | — | **BLOCKED**: migration 0012 and the menu seed need approval (ISSUE-071) |

## J. Custody and cash handover (round 9)

| ID | Flow | Evidence | Status |
|---|---|---|---|
| CUS-01 | Each payment credited to the employee holding it (staff id); a Manager receiving a balance holds it | VL-52 | **VERIFIED-PG** |
| CUS-02 | Employee sees only own custody; server refuses others' (403) | VL-52, VL-53, VL-54 | **VERIFIED-PG + BROWSER + local** |
| CUS-03 | Declaration computed from and linked to undeclared collections; one pending at a time; concurrent → one | VL-52, VL-53 | **VERIFIED-PG + BROWSER** |
| CUS-04 | Verification of cash and UPI separately; exact → ACCEPTED, difference + reason → DISCREPANCY_FLAGGED; stale or duplicate rejected; one ledger entry per kind | VL-52, VL-53 | **VERIFIED-PG + BROWSER** |
| CUS-05 | Owner staff-wise table, totals = Σ rows, per-employee history | VL-52, VL-53, VL-54 | **VERIFIED-PG + BROWSER + local (read)** |
| CUS-06 | Declarations and acceptances appear in other open screens without a reload | VL-53 (about 0.6 s) | **VERIFIED-BROWSER** |
| CUS-07 | Declare / accept on your local data | — | Not exercised on purpose (it would post real entries to your books) |

