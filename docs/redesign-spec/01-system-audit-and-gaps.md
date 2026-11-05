# Ravinarayan ERP — System Audit, Feature Inventory and Gap Analysis

Deliverables 1, 2 and 3. Written for the product owner and for the AI agent that will implement the redesign.

**How this was produced.** Read-only inspection of `apps/erp` on 2026-11-01: routes, 120 API routes, service layer, schema (`server/database/schema/index.ts`, 16 migrations 0000–0015), permissions, navigation and the module components. Existing project records (`docs/FLOW_VERIFICATION.md`, `docs/ISSUE_REGISTER.md`, `docs/ORDER_DELIVERY_WORKFLOW.md`) were used as evidence of what was tested earlier. **No app was run for this audit and no data or database was touched.** "Fully functional" below therefore means: complete in code through UI, API, service and schema, *and* covered by a recorded verification where one exists. Where I only read the code, the status says so.

**Two corrections to the brief's premise.**
1. The delivery boy app is **not a separate codebase**. It is the `/delivery` section of this same Next.js app (`modules/delivery/ops/Staff*.tsx`), shown to the `DELIVERY_PERSON` role, wrapped by the Capacitor Android shell in `mobile/`. There is no separate "Android backend". The cross-app comparison is therefore *manager views vs driver views of the same services*. It stays untouched, as instructed.
2. `docs/ISSUE_REGISTER.md` is partly stale. ISSUE-023 ("no assign/reassign UI") is out of date: `TaskPanel.tsx` has Assign/Reassign, Retry, Cancel, Resolve and Collect. `FEATURE_FLOW_STATUS.md` is marked superseded by the project itself. This audit relies on code.

---

## 1. Existing system architecture (Deliverable 1)

| Layer | What exists |
|---|---|
| Frontend | Next.js 14 App Router, React 18, Tailwind, lucide-react. Management layout `app/(management)/*`; auth pages `app/(auth)/*`; public `/download`, `/offline`. Client data layer `useErpQuery` (cache, mutate, invalidate) plus SSE (`/api/events`) that invalidates tags; polling fallback. |
| Shell | `ErpShell`: left sidebar (desktop), drawer + bottom nav (mobile), notification bell, profile menu, "Live" connection badge. Delivery role gets `DeliveryStaffShell` (orange edition, floating bottom pill nav). |
| Backend | Route handlers under `app/api/*` call services in `server/<module>/*Service.ts`. Every service calls `requirePermission`. Mutations write `audit_logs`. CSRF same-origin check in middleware. |
| Database | PostgreSQL (Neon in production) via postgres.js `AsyncDb`, Drizzle SQL migrations. Money stored as integer rupees. Dates stored as text (`YYYY-MM-DD` / ISO). ~37 tables (below). |
| Auth | Password + emailed OTP (3 tries, 10 min), single active session (new login pre-empts the old), bcrypt, login throttling, password recovery by email link, account password/email change with codes to old and new email. |
| Notifications | `notificationService` derives a feed from live queries (not a stored queue); read state in `staff_notification_reads`. Push (FCM) for delivery assignment/cancel on Android, not yet configured. |
| Email | `EmailAdapter` (Outbox/Mock/SMTP/Brevo/Resend). Brevo/Resend needed on Render (SMTP blocked). |
| Delivery app | Same codebase, role-based. Native extras in `mobile/`. |

**Tables (grouped).** Access: `staff_users, sessions, session_preemptions, login_attempts, auth_challenges, password_resets, audit_logs, push_tokens`. Property: `rooms, residents, resident_stays, resident_settlements, document_attachments`. Money: `financial_transactions, invoices, invoice_items, invoice_payment_allocations, invoice_counters, daily_cashbook_closings, driver_cash_handovers`. Tiffin: `tiffin_customers, tiffin_products, tiffin_subscriptions`. Kitchen: `resident_meal_preferences, daily_meal_plans, resident_meal_records, meal_plan_adjustments, kitchen_raw_materials, kitchen_recipes, kitchen_recipe_ingredients, kitchen_stock_movements, kitchen_production_consumptions`. Orders/delivery: `orders, order_items, delivery_tasks, delivery_task_events`. Notifications: `staff_notification_reads`.

**Roles (permission-enforced).** `SUPER_ADMIN` (Owner), `OPERATIONS_MANAGER`, `DELIVERY_PERSON` are the canonical, assignable roles. `ACCOUNTANT` and `KITCHEN_OPERATIONS` are legacy: still valid for existing accounts, not assignable, and have no navigation.

**Known technical limits.** SSE signals are per server process (several instances would need `LISTEN/NOTIFY`). Dashboard uses `new Date().toISOString()` (UTC) for "today" at `dashboardService.ts:125`; other screens were fixed to the business date (ISSUE-042) — a likely 00:00–05:30 IST off-by-one on dashboard month boundaries and "today". `[ORDER_JSON]` is still dual-written (ISSUE-035). Walk-in sale endpoint posts a sale without an `orders` row (ISSUE-034).

---

## 2. Feature inventory (Deliverable 2)

Classification key: **F** fully functional · **P** partially functional · **U** UI only · **B** backend only (no screen) · **I** incomplete workflow · **M** missing · **X** broken.

### Navigation as shipped (7 items)
Dashboard · Rooms & Inventory · Residents & Stays · Finance & Cashbook · Orders · Delivery · Staff Administration (Owner only). Plus Account (all roles). `/kitchen` and `/tiffin` redirect to `/orders`.

| # | Module / feature | Class | Evidence and notes |
|---|---|---|---|
| 1 | Login (password → OTP), forgot/reset password | F | AUTH-01..07 verified in browser/tests. Real email delivery needs Brevo on Render. |
| 2 | Session pre-emption, logout, session-expired handling | F | Verified (SQLite/PG mix). |
| 3 | Account: change password, change email (codes to both inboxes), devices list, sign out others | F | Browser-tested this project. |
| 4 | Dashboard KPIs, occupancy, finance, meal fulfilment, delivery summary, 6-month chart, CSV export | P | Renders and caches correctly. See §2.1 for definition problems and the UTC date issue. |
| 5 | Rooms: list, filter, create, edit, deactivate, delete (guarded) | F (service SQLite-only) | ROOM-01..03. 22-room layout, 39 beds as enforced by tests. |
| 6 | Bed-level allocation (which bed in a room) | M | Schema has room capacity and stays only; no `beds` table. "Bed" is a count, not an entity. |
| 7 | Room maintenance / blocked state | M | Only `is_active`. |
| 8 | Residents: register, edit, profile + stay history | F | RES-01/04. |
| 9 | Check-in, transfer, check-out with settlement and deposit refund | F (check-out VERIFIED-PG; check-in/transfer UI not browser-tested) | RES-02/03/06. |
| 10 | Resident KYC documents (upload, view, delete) | F (SQLite-only) | DOC-01/02. |
| 11 | Rent charge / payment / deposit / expense posting, reversal (Owner) | F | VERIFIED-PG. |
| 12 | Monthly rent auto-generation | M | Charges are recorded manually; I found no scheduler. Confirm with owner. |
| 13 | Cashbook with Combined / PG / Tiffin views | F | FIN-06 (SQLite-only evidence). |
| 14 | Resident statements / dues | F | FIN-07. |
| 15 | Invoices: draft, issue, allocate, cancel, unallocated payments | F | VERIFIED-PG. Owner only. |
| 16 | Daily closing: preview, draft, finalize, reopen, variance reason | F | VERIFIED-PG. Owner only for finalize/reopen. |
| 17 | Orders: create delivery or dine-in order, history, reuse, live status | F | VERIFIED-PG + browser. |
| 18 | Order edit / cancel | M | ISSUE-036, owner decision pending. (Delivery-task cancel exists; order cancel does not.) |
| 19 | Orders page "Subscriptions today" (skip/override per subscription or resident) | F | `SubscriptionsToday`, routes `delivery/subscriptions-day`, `residents-day`. |
| 20 | Delivery board (assign, batch assign/dispatch, reassign, retry, cancel, resolve, collect), problems, custody, history, export day | F | `ManagerDelivery`, `TaskPanel`. Browser-verified for driver side; manager actions covered by PG suites. |
| 21 | Driver cash custody, declare handover, manager accepts | F | DEL-07/08 VERIFIED-PG (acceptance). |
| 22 | Delivery staff: shift app (stops, mark delivered, collect, cash, history), offline queue | F | VERIFIED-PG + browser + emulator. |
| 23 | Staff administration: list, create, role, deactivate, admin reset, recovery link, history | F | Owner only. |
| 24 | **Tiffin customers** (directory, status, balance) | **B** | `TiffinCustomerDirectory.tsx` (671 lines) is imported nowhere. API exists. |
| 25 | **Tiffin plans/products catalogue** | **B** | `TiffinPricingCatalog.tsx` orphaned. Orders uses a read-only `MenuCatalog`. Menu is currently *empty* on the local DB. |
| 26 | **Tiffin subscriptions** (create, pause, resume, cancel) | **B** | `TiffinSubscriptionList.tsx` orphaned. Subscriptions can exist in DB but cannot be created or edited by anyone in the UI. |
| 27 | **Tiffin monthly billing** (preview, generate, exceptions) | **B** | `TiffinBillingView.tsx` orphaned. |
| 28 | **Kitchen demand, meal plans, prep sheet, reconcile** | **B** | Routes `/api/kitchen/*` exist; no page. |
| 29 | **Kitchen inventory, recipes (BOM), consumption, waste, adjustments** | **B** | `InventoryManagerView`, `RecipeManagerView`, `ProductionConsumptionView` orphaned (~2,000 lines). |
| 30 | **Walk-in sale** | **B** | `RecordWalkInSaleModal` orphaned. Dine-in orders replace the need, but ISSUE-034 remains. |
| 31 | Meal preferences / opt-outs per resident | B | `resident_meal_preferences`, `/kitchen/eligibility`; only the "residents today" toggle in Orders touches it. |
| 32 | Notifications feed (6 derived types) | P | Exception, unassigned, out-for-delivery, rent due, payment received, kitchen plan. No payment reminders to customers, no subscription-expiry, no pending-settlement alert, no email/SMS reminders. |
| 33 | Audit log viewer | M | `audit_logs` written everywhere, `audit.read` permission exists; only per-staff history and per-task timeline screens exist. No global activity log page. |
| 34 | Reports | P | Executive CSV and business division report only. No occupancy, delivery-performance, expense, outstanding or meal-quantity reports. |
| 35 | Settings (business, meal timings, payment, delivery, notification preferences) | M | No page. Cut-off times and defaults live in code/env (e.g. `ERP_DEFAULT_DELIVERY_USERNAME`). |
| 36 | Public website | F | Separate app `apps/website`; out of scope for ERP redesign. |

### 2.1 Dashboard metric defects found in code (not fabricated; check before reuse)
- `totalDepositsHeld` — **corrected 2026-11-01:** the formula did subtract refunds and applications (the earlier reading of this line was wrong). The real defect was that checkout deductions kept by the business are not ledger rows, so they stayed counted as held. Fixed; see `docs/FINANCIAL_DEFINITIONS.md` (ISSUE-082).
- `outstandingRent` is `max(0, billed − collected)` over all time, which can hide an overpayment in one resident behind a debt in another. Per-resident dues (already computed for `overdueCount`) are the safer basis.
- Tiffin revenue matching uses `description LIKE '%tiffin%'` as one clause. Text matching on a free-text field is fragile; use `customer_id`/`category`.
- "Today" uses UTC (see §1).

---

## 3. Cross-application gap analysis (Deliverable 3)

### 3.1 Driver app vs manager ERP matrix

| Capability | Driver view | Backend | Manager ERP | Gap / required action |
|---|---|---|---|---|
| See own assigned stops, FIFO order | F | F | n/a | none |
| Assignment and reassignment | read only | F | F (single + batch + dispatch) | none; auto-assign relies on a default driver env var → move to Settings |
| Delivery status and timeline | status | F `delivery_task_events` | P: timeline modal exists in code but is not imported (`TaskTimelineModal` unused) | Surface the per-stop timeline in the Task panel |
| Delivered / undelivered quantity per item, reason, disposition | F | F `order_items` | F (Problems tab) | none |
| Payment collection (cash/UPI), balance, collect later | F | F | F (collect, balance) | Add collection reconciliation view: expected vs collected per driver per day |
| Failed delivery / exception | F | F | P: Problems tab lists; retry/resolve in panel | Add exception queue with ageing and counts on dashboard |
| Cancel stop (cut-off, manager override) | notified | F | F | none |
| Cash custody and handover | F declare | F | F (Custody tab) | Closing lock bypass on handover accept was reported (task 62) and later fixed (VERIFIED-PG §D) |
| Delivery history with filters | F | F | F (History + export) | Add driver filter and date-range summary |
| Driver performance (on-time, completion rate, cash variance) | M | derivable | M | Add report (see spec) |
| Driver availability / shift | M | M | M | Not supported anywhere; **decision needed** whether wanted |
| Push alerts for new stop | built | F | n/a | Needs Firebase configuration by owner |
| Offline queue sync | F | F | n/a | visibility of "pending sync" not exposed to manager (low priority) |

### 3.2 Backend/database capability not exposed in the ERP (highest impact)
1. **Tiffin customer directory, catalogue, subscriptions, billing** — complete service and API, orphaned UI. Without them the Orders page can show "Subscriptions today" but nobody can create a subscription. *Priority P0.*
2. **Kitchen planning, demand, inventory, recipes and consumption** — complete service, orphaned UI. *Priority P1* (owner must confirm the kitchen still wants this after "Tiffin Operations Redesign" removed it from the nav, doc `TASK_01B_70`).
3. **Resident meal preferences/opt-outs** as a managed list. *P2.*
4. **Audit log** global viewer. *P1* for the Owner.
5. **Settlement history** (`GET /residents/[id]/settlement`) — verify it is shown in the profile. *Unverified.*
6. **Notifications** beyond the 6 derived types. *P2.*

### 3.3 Missing or incomplete workflows
- Order edit/cancel (ISSUE-036, decision needed: refund/ledger rules).
- Bed entity and room maintenance state.
- Rent charge automation (unconfirmed).
- Reports listed in the brief other than CSV export.
- Settings module.
- Customer-facing payment reminders, subscription expiry alerts.
- Checkout settlement authority (ISSUE-026): Manager can finalize deposit refunds today.
- Quoted party snacks and price override (ISSUE-072).

### 3.4 Possibly broken or inconsistent (to verify in a test run, not asserted as defects)
Dashboard "today" in UTC; `totalDepositsHeld` formula; `docs/ISSUE_REGISTER` stale entries; the `Online`/localhost link `http://localhost:3000` in `ErpShell.tsx` lines 454 and 577 (hard-coded to the public website; on production it points nowhere useful — should use the website URL from config).

### 3.5 Owner decisions required
1. Is the Kitchen module (plans, inventory, recipes) still wanted? If yes, where does it live in the navigation?
2. Tiffin subscriptions: keep monthly packages billed by invoice, or only per-order delivery? (Products currently excluded from order items.)
3. Order edit/cancel rules and refund treatment (ISSUE-036).
4. Manager's authority on deposit refunds (ISSUE-026).
5. Whether beds should be individual records (bed numbers) or stay a count.
6. Rent: manual monthly charge, or automatic on a day each month?
7. Driver availability/shift tracking wanted?
8. Meaning of "deposits held" and "outstanding" for the dashboard.
9. Which email channel for customer reminders (Brevo is already available) and whether SMS/WhatsApp is wanted.
10. Spelling of product names (PRD vs seed) — listed in `ORDER_DELIVERY_WORKFLOW.md`.
