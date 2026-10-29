# Flow Verification

Flow-by-flow inventory with the evidence actually obtained. **A flow is only `VERIFIED` when it was exercised end to end (UI → API → service → PostgreSQL → response/UI) or, for backend-only rules, against live PostgreSQL.**

Status values:
- `VERIFIED-PG`: business rule exercised against live PostgreSQL 16 (disposable local DB).
- `SQLITE-ONLY`: service logic covered by a passing legacy suite on the SQLite double. Postgres-specific branches, route handlers and UI are **not** exercised.
- `FAILED`: a check demonstrates the flow is broken.
- `BLOCKED`: cannot be verified safely; the reason is given.
- `NOT VERIFIED`: code exists, no meaningful evidence yet.
- `NOT IMPLEMENTED`.

Common to every API flow: middleware requires the session cookie (except auth/health) and a same-origin CSRF check on POST/PUT/PATCH/DELETE; the service calls `requirePermission`; mutations write `audit_logs` with actor id/username. Browser-level verification: **none yet** (Batch 7).

Suites referenced are in `tests/`; results come from VL-10 in [VERIFICATION_LOG.md](VERIFICATION_LOG.md).

---

## A. Authentication & sessions

| ID | Flow | Role | UI → API | Service | Writes / tx | Evidence | Status |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Password login → OTP challenge | any | `/login` → `POST /api/auth/login` | `auth.ts` login/challenge | `auth_challenges`, `login_attempts` | otp_auth_flow, auth_hardening (partial) | SQLITE-ONLY |
| AUTH-02 | OTP verify → session (preempts old session) | any | `POST /api/auth/otp/verify` | `verifyOtpChallenge` | `sessions`, `session_preemptions` | otp_auth_flow | SQLITE-ONLY |
| AUTH-03 | OTP resend / attempt limit (3) / expiry (10 min) | any | `POST /api/auth/otp/resend` | `resendOtpChallenge` | `auth_challenges` | otp_auth_flow | SQLITE-ONLY |
| AUTH-04 | Brute-force throttling (IP / account+IP) | any | login | `auth.ts` rate limiter | `login_attempts` | auth_hardening (runs until the backup step) | SQLITE-ONLY (suite BLOCKED at restore step) |
| AUTH-05 | Forgot password → reset link (generic response) | any | `/forgot-password` → `POST /api/auth/forgot-password` | `initiatePasswordReset` | `password_reset_tokens` | task56 | SQLITE-ONLY |
| AUTH-06 | Reset password (single use, revokes sessions) | any | `/reset-password` → `POST /api/auth/reset-password` | `completePasswordReset` | tokens, `staff_users`, `sessions` | task56 | SQLITE-ONLY |
| AUTH-07 | Logout / session validation / `me` | any | `POST /api/auth/logout`, `GET /api/auth/me` | `destroySession`, `validateSessionDetailed` | `sessions` | auth_hardening | SQLITE-ONLY |
| AUTH-08 | Real SMTP OTP delivery | any | — | `emailAdapter` (Gmail SMTP) | — | task75 needs real SMTP | BLOCKED (external service) |

## B. Staff administration & RBAC

| ID | Flow | Role | API | Service | Evidence | Status |
|---|---|---|---|---|---|---|
| STAFF-01 | List/search staff, KPI stats | Owner, Manager (read) | `GET /api/staff` | `staffService.listStaffUsers` | task56 | SQLITE-ONLY |
| STAFF-02 | Create staff (canonical roles in UI) | Owner | `POST /api/staff` | `createStaffUser` | task56 | SQLITE-ONLY; API also accepts legacy roles (ISSUE-012) |
| STAFF-03 | Change role (sole Super Admin guard) | Owner | `PUT /api/staff/[id]/role` | `updateStaffRole` | task56, rbac | SQLITE-ONLY |
| STAFF-04 | Activate/deactivate (revokes sessions; sole SA guard) | Owner | `PUT /api/staff/[id]/status` | `setStaffActiveStatus` | task56 | SQLITE-ONLY |
| STAFF-05 | Admin password reset / recovery link | Owner | `POST /api/staff/[id]/reset-password`, `/recovery` | staffService | task56 | SQLITE-ONLY |
| STAFF-06 | Staff audit history | Owner | `GET /api/staff/[id]/history` | `getStaffAuditHistory` | task56 | SQLITE-ONLY |
| RBAC-01 | Server rejects wrong-role requests on every service | all | all | `requirePermission` | rbac_staff_foundation | SQLITE-ONLY |
| RBAC-02 | Role-aware navigation / bottom bar | all | `ErpShell.tsx` | — | task67/68 (updated to three-role model) | SQLITE-ONLY (static source checks; browser pending) |

## C. Rooms & residents

| ID | Flow | Role | API | Service | Writes / tx | Evidence | Status |
|---|---|---|---|---|---|---|---|
| ROOM-01 | Room list / filters / occupancy | Owner, Manager | `GET /api/rooms` | `roomService.listRooms` | — | rooms_residents, task54 | SQLITE-ONLY |
| ROOM-02 | Create/update room (unique nocase number, capacity>0) | Owner, Manager | `POST /api/rooms`, `PATCH /api/rooms/[id]` | `createRoom`, `updateRoom` | `rooms` | task54 | SQLITE-ONLY |
| ROOM-03 | Deactivate/delete guarded by occupancy/history | Owner, Manager | `PATCH`/`DELETE /api/rooms/[id]` | `setRoomActiveStatus`, `deleteRoom` | `rooms` | task54 | SQLITE-ONLY |
| RES-01 | Register resident (unique phone) | Owner, Manager | `POST /api/residents` | `registerResident` | `residents` | rooms_residents | SQLITE-ONLY |
| RES-02 | Check-in (capacity, single active stay) | Owner, Manager | `POST /api/residents/check-in` | `assignResidentToRoom` | `resident_stays` (tx) | rooms_residents, task54 | SQLITE-ONLY; PG row locks untested |
| RES-03 | Room transfer (atomic) | Owner, Manager | `POST /api/residents/transfer` | `transferResidentRoom` | stays (tx) | task54 | SQLITE-ONLY |
| RES-04 | Update resident | Owner, Manager | `PATCH /api/residents/[id]` | `updateResident` | `residents` | rooms_residents | SQLITE-ONLY |
| RES-05 | Checkout preview | Owner, Manager | `GET /api/residents/check-out/preview` | `previewResidentSettlement` | — | task52 | SQLITE-ONLY |
| RES-06 | Checkout settlement (deductions, deposit application, refund) | Owner (finance.manage for money parts) | `POST /api/residents/check-out` | `residentSettlementService` | stays, ledger (tx, closing lock PG) | task52, task61 | SQLITE-ONLY |
| RES-07 | Settlement history | Owner, Manager | `GET /api/residents/[id]/settlement` | `listResidentSettlements` | — | task52 | SQLITE-ONLY |
| DOC-01 | Upload KYC/receipt (magic bytes, ≤5 MB) | Owner, Manager | `POST /api/documents` | `documentService` | `document_attachments`, disk | task57 | SQLITE-ONLY |
| DOC-02 | Download / view / delete document | Owner, Manager | `GET /api/documents/[id]/download`, `DELETE /api/documents/[id]` | documentService | — | task57 | SQLITE-ONLY |

## D. Finance, invoicing & closing

| ID | Flow | Role | API | Service | Writes / tx | Evidence | Status |
|---|---|---|---|---|---|---|---|
| FIN-01 | Rent charge | Owner (finance.manage) | `POST /api/finance/transactions` | `recordRentCharge` | ledger (tx + closing lock) | finance | SQLITE-ONLY |
| FIN-02 | Rent payment (overpayment guard, idempotency) | Owner | same | `recordRentPayment` | ledger | finance, task61 | SQLITE-ONLY |
| FIN-03 | Security deposit | Owner | same | `recordSecurityDeposit` | ledger | finance | SQLITE-ONLY |
| FIN-04 | Expense (division by category; receipt attachment) | Owner | same | `recordExpense` | ledger (tx + closing lock) | finance, **pg_closing_locks** | **VERIFIED-PG** (closing-lock rule, rollback on lock failure); other branches SQLITE-ONLY |
| FIN-05 | Reversal (business-date, cross-period) | Owner | same | `reverseTransaction` | ledger | finance, task63 | SQLITE-ONLY |
| FIN-06 | Cashbook summary / division views | Owner, Manager | `GET /api/finance/cashbook`, `/api/reports/business` | `getCashbookSummary`, reporting | — | task55, task61 | SQLITE-ONLY |
| FIN-07 | Resident financial summary | Owner, Manager | `GET /api/finance/residents/[id]` | `getResidentFinancialSummary` | — | finance | SQLITE-ONLY |
| INV-01 | Create draft invoice (GST/regular, GSTIN validation) | Owner | `POST /api/finance/invoices` | `invoiceService` | `invoices` | invoicing, task50, task64 | SQLITE-ONLY |
| INV-02 | Issue invoice (sequential `INV-YYYY-XXXX`) | Owner | `POST /api/finance/invoices/[id]/issue` | `issueInvoice` | invoices (tx, closing lock) | task50 | SQLITE-ONLY; PG sequence concurrency untested |
| INV-03 | Allocate payment to invoice | Owner | `POST /api/finance/invoices/[id]/allocate` | `allocatePaymentToInvoice` | invoices + ledger | task51 | SQLITE-ONLY |
| INV-04 | Cancel invoice (closing lock on issue date) | Owner | `POST /api/finance/invoices/[id]/cancel` | `cancelInvoice` | invoices | task63 | SQLITE-ONLY |
| CLS-01 | Closing preview per division | Owner, Manager | `GET /api/finance/closing/preview` | `previewDailyClosing` | — | task53 | SQLITE-ONLY |
| CLS-02 | Save closing draft | Owner | `POST /api/finance/closing` | `saveDailyClosingDraft` | closings | task53 | SQLITE-ONLY |
| CLS-03 | Finalize closing (variance reason, snapshot, lock) | Owner | `POST /api/finance/closing` | `finalizeDailyClosing` | closings (tx, X advisory lock, FOR UPDATE) | task53, task61, **pg_closing_locks** | **VERIFIED-PG** (no deadlock, snapshot includes in-flight writes, late writes rejected) |
| CLS-04 | Reopen closing | Owner | `POST /api/finance/closing/[id]/reopen` | `reopenDailyClosing` | closings | task53 | SQLITE-ONLY |
| CLS-05 | Concurrent writers vs finalization | system | — | lock helpers | — | pg_closing_locks §1, §4 | **VERIFIED-PG** |

## E. Tiffin, orders & kitchen

| ID | Flow | Role | API | Service | Evidence | Status |
|---|---|---|---|---|---|---|
| TIF-01 | Customer directory CRUD, search, status | Owner, Manager | `/api/tiffin/customers*` | tiffinService | tiffin | SQLITE-ONLY |
| TIF-02 | Product catalog CRUD / seed defaults / status | Owner, Manager | `/api/tiffin/products*` | tiffinService | tiffin | SQLITE-ONLY |
| TIF-03 | Subscription create / pause / resume / cancel | Owner, Manager | `/api/tiffin/subscriptions*` | tiffinService | tiffin | SQLITE-ONLY |
| TIF-04 | Billing preview → invoice generation | Owner (finance.manage) | `/api/tiffin/billing/preview`, `/generate` | tiffinBillingService | tiffin | SQLITE-ONLY |
| TIF-05 | Record tiffin payment | Owner | `POST /api/tiffin/payments` | `recordTiffinPayment` | tiffin, task61 | SQLITE-ONLY |
| TIF-06 | Prepaid billing exceptions | Owner | `/api/tiffin/billing/exceptions` | tiffinBillingService | tiffin | SQLITE-ONLY |
| ORD-01 | New order (delivery) → task auto-assigned to default driver & dispatched | Owner, Manager | `/orders` → `POST /api/orders` | `createUnifiedOrder`, `getDefaultDeliveryStaff` | task70 (configured default, no name matching), task71 | SQLITE-ONLY; JSON-in-notes (ISSUE-008) |
| ORD-02 | New order (dine-in) → ledger sale (closing lock) | Owner, Manager | `POST /api/orders` | `createUnifiedOrder` | task71 | SQLITE-ONLY |
| ORD-03 | Duplicate-phone customer prevention | Owner, Manager | `POST /api/orders` | orderService | task71 | SQLITE-ONLY |
| ORD-04 | Customer order history / repeat order | Owner, Manager | `GET /api/orders/history` | `getCustomerOrderHistory` | task70 | SQLITE-ONLY |
| ORD-05 | Edit / cancel an order | — | — | — | — | NOT IMPLEMENTED (no endpoint) |
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
| DEL-01 | Task list / summary / staff list | Owner, Manager, Driver (own tasks) | `GET /api/delivery/tasks`, `/summary`, `/staff` | deliveryService | delivery | SQLITE-ONLY |
| DEL-02 | Generate resident tasks from confirmed plan | Owner, Manager | `POST /api/delivery/tasks/generate` | `generateDeliveryTasks` | delivery | SQLITE-ONLY |
| DEL-03 | Assign / batch assign / dispatch / batch dispatch | Owner, Manager | `/assign`, `/batch-assign`, `/dispatch`, `/batch-dispatch` | deliveryService | delivery | SQLITE-ONLY (API only: no assign UI on `/delivery`, ISSUE-023) |
| DEL-04 | Complete delivery (portions, shortfall reason, CASH/UPI collection, idempotency key) | Driver, Manager | `POST /api/delivery/tasks/[id]/deliver` | `completeDeliveryTask` | delivery, task70, task71, **pg_delivery_sync §3** | **VERIFIED-PG** (applied once under concurrent completions); UI pending |
| DEL-05 | Exception / retry | Driver, Manager | `/exception`, `/retry`; UI: 0 delivered + reason | deliveryService | delivery, **pg_delivery_sync §5** | Zero-delivered → EXCEPTION **VERIFIED-PG**; `/exception` and `/retry` have no UI (API only) |
| DEL-06 | Offline completion queued and synced | Driver | modal → `offlineQueue.ts` → `ErpShell` auto-replay → `POST /api/delivery/sync` | `syncDeliveryActions` | task66, **pg_delivery_sync §1, §2, §4** | Server side **VERIFIED-PG** (partial data kept, replay idempotent, cross-account rejected). Client enqueue/replay: static checks only; **browser/phone test pending** |
| DEL-07 | Driver declares shift handover | Driver | `POST /api/delivery/handover/declare` | `createCashHandoverDeclaration` | task58 | SQLITE-ONLY |
| DEL-08 | Manager accepts handover → ledger TIFFIN_PAYMENT (closing lock, optimistic status) | Owner, Manager | `POST /api/delivery/handover/[id]/accept` | `acceptCashHandover` | task58, task63 | SQLITE-ONLY |
| DEL-09 | Fleet / driver custody summary | Owner, Manager, Driver | `GET /api/delivery/handover?summary=true` | route + deliveryService | task70 | SQLITE-ONLY |

## G. Reporting, notifications, platform

| ID | Flow | Role | API | Evidence | Status |
|---|---|---|---|---|---|
| RPT-01 | Dashboard KPIs, revenue chart | Owner, Manager | dashboardService | integration_audit, task63 | SQLITE-ONLY |
| RPT-02 | Executive CSV export (formula-injection safe) | Owner, Manager | `GET /api/reports/executive` | task55 | SQLITE-ONLY |
| RPT-03 | Business division report | Owner, Manager | `GET /api/reports/business` | task55 | SQLITE-ONLY |
| NOT-01 | Notification feed + read state | all | `GET/POST /api/notifications` | async_bridge (idempotent read) | SQLITE-ONLY |
| PLT-01 | Health check | public | `GET /api/health` | postgresql_phase01 (now self-contained, passes) | SQLITE-ONLY |
| PLT-02 | PWA manifest, service worker (no API caching), `/offline` page | all | static | task66 (other assertions pass) | SQLITE-ONLY (static checks) |
| PLT-03 | Migrations 0000–0011 apply to empty PG16 | ops | `scripts/migrate.js` | VL-07 | **VERIFIED-PG** |
| PLT-04 | Migration target validator blocks remote/protected DBs | ops | `scripts/migrate.js` | task73 | SQLITE-ONLY (pure function) |
| PLT-05 | Test/seed target validator (`validatePostgresTargetSafety`) default-deny | ops | `pgIntegration.ts` | postgresql_integration_and_readiness | Pure function, verified (ISSUE-003) |
| PLT-06 | ERP production build | ops | `next build` (sandbox, no env) | VL-15 | Builds (exit 0, warnings untriaged) |
| WEB-01 | Public website pages (home, rooms, tiffin-service, about, contact) | public | `apps/website` | none | NOT VERIFIED |
