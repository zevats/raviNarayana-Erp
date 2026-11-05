# Functional restoration and completion — November 2026

Implementation of the "Complete functional restoration, enhancement & backend implementation" brief. UI restructuring was **not** done (separate phase); new screens use the existing look. Kitchen stays out of scope (its tables and code are untouched and dormant).

Owner decisions taken during the work (2026-11-01): partial-month rent is **prorated by days**; an order with **any money collected cannot be cancelled** (dine-in orders never).

## 1. Summary by phase

| Phase | Delivered |
|---|---|
| 0 Correctness | One business-date utility used everywhere (dashboard "today" and 6-month window, cashbook/report periods, check-out default, delivery summary, closing preview, executive CSV, tiffin due date, finance date helpers). Canonical money definitions in `server/finance/financialDefinitions.ts` + `docs/FINANCIAL_DEFINITIONS.md`: deposits held now subtract checkout deductions; outstanding rent per resident; tiffin revenue by stable references, never counted as rent too. Website link from Settings (was `localhost:3000`). Issue register refreshed. Stop timeline was already in the stop panel (old modal left unused). |
| 1 Tiffin | `/tiffin` restored: customers (profile now shows subscriptions, invoices, payments, balance), menu & prices, subscriptions (create/edit/pause/resume/cancel), billing (Owner). Editing a subscription now updates deliveries already listed. Quantity 0 refused on create. Default-menu seed: Owner only, preview then confirm, adds only missing items, never re-prices. |
| 2 Delivery | Default delivery partner in Settings; if that person is switched off, orders wait unassigned and an alert appears (no silent substitute). Owner/Manager can take one delivery themselves (single or bulk) with a reason; no role or app access granted, default unchanged, history keeps the previous assignee. Board: person filter, per-person day summary (stops, delivered, partly, not delivered, open, cancelled, collected of due). Problems show how long each has been open. Orders show who delivers or "Not assigned yet". |
| 3 Property & rent | Individual beds (migration 0017; existing rooms backfilled, existing residents kept with no bed until placed), bed choice at check-in/transfer, out-of-service beds, room maintenance blocking new residents only. Automatic monthly rent (Settings → due day; dashboard trigger or Finance → Monthly Rent), prorated by days, idempotent, adjusted on check-out/transfer. Settlement approvals (migration 0018): Manager prepares, Owner approves any deposit movement. |
| 4 Orders | Edit (items, address, notes) and cancel for delivery orders not yet attempted and with nothing collected; agreed prices kept, new items priced by the server; cutoff needs Manager override + reason; revisions kept (migration 0019); cancelled orders keep who/when/why. |
| 5 Settings | `/settings` (Owner): business details (used on invoices and the menu link), meal list times and cutoffs (used by every delivery rule), default delivery partner, rent due day, alert switches. Stored in the database, audited with old/new values. |
| 6 Activity log | `/activity` (Owner, read-only) over `audit_logs`: filters by person, area, date, search; details with sensitive fields redacted. Sign-in and sign-out are now audited. |
| 7 Notifications | Feed filtered by role; new: subscription ending (7 days), cash handed over not accepted, yesterday not closed, settlement awaiting approval, default partner unavailable; links open the exact tab/stop; kitchen item removed. Switches in Settings. |
| 8 Reports | `/reports`: daily closing, rent collection, occupancy (any date, from stay dates), resident ledger (running balance), expenses, tiffin revenue, deliveries, cash with staff, outstanding balances. Date range, division, search, paging with full totals, safe CSV, row links to the records. |
| 9 Dashboard | New top section: today's deliveries (waiting, out, delivered of total, problems, boxes per meal, cash with staff), people and rooms, money this month (collected, expenses, collected minus expenses, cash in hand, last closed day, yesterday-unclosed banner) and four defined charts (daily collections 30 d, delivery completion 14 d, expenses by category, month-end occupancy 6 m) with hover and table view. Hard-coded "39 beds / 21 rooms" replaced by live counts. Each block reports its own failure. |

## 2. Restored components
TiffinCustomerDirectory, TiffinSubscriptionList, TiffinPricingCatalog, TiffinBillingView and their modals (CustomerModal, CustomerDetailModal, SubscriptionModal, SubscriptionDetailModal, PauseSubscriptionModal, CancelSubscriptionModal, ProductModal, GenerateTiffinInvoicesModal, RecordTiffinPaymentModal, TiffinCustomerBalanceModal).

## 3. New / changed APIs
New: `/api/settings` (GET/PUT), `/api/settings/business`, `/api/activity`, `/api/reports`, `/api/finance/rent-run` (GET preview / POST), `/api/rooms/[id]/beds`, `/api/rooms/beds/[bedId]` (PATCH/DELETE), `/api/rooms/[id]/maintenance` (GET/POST), `/api/residents/stays/[stayId]/bed`, `/api/residents/settlement-proposals` (GET/POST), `/api/orders/[id]` (PATCH), `/api/orders/[id]/cancel`, `/api/orders/[id]/revisions`.
Changed (backward compatible): `/api/delivery/tasks/[id]/assign` (optional `reason`; self-assignment), `/api/residents/check-in` and `/transfer` (optional `bedId`), `/api/residents/check-out` (a Manager's deposit-moving settlement returns 202 `pendingApproval`), `/api/tiffin/products/seed` (GET preview, POST needs `{confirm:true}`, Owner only).

## 4. Migrations (all additive; applied only by the production migrator)
0016 `business_settings` · 0017 `room_beds`, `resident_stays.bed_id`, `room_maintenance` (+ bed backfill from capacity) · 0018 `settlement_proposals` · 0019 `order_revisions`, `orders.revision/cancelled_at/cancelled_by/cancel_reason`.

## 5. Permission changes
- Deposit refunds/deductions/applications at checkout: Owner only (Manager sends for approval).
- Default-menu seed: Owner only (was any `tiffin.manage`).
- Settings, Activity log: Owner (`system.manage`).
- Self-assignment of a delivery: the Owner/Manager making the change, to themselves only; no new permission.
- Notifications now follow permissions (delivery staff get no money/management items).

## 6. Delivery assignment — examples
- New delivery order → Settings partner (if active) → else `ERP_DEFAULT_DELIVERY_USERNAME` → else longest-serving active delivery staff.
- Settings partner switched off → order stays unassigned, bell alert "Default delivery partner unavailable".
- Manager picks "Me — <name>" on one stop with reason "Driver busy" → stop moves to the Manager, timeline reads "Reassigned from Dinesh to <Manager> (handling it personally). Reason: Driver busy"; next order still goes to Dinesh; cash the Manager collects is in the Manager's custody.

## 7. Tests
New live-PostgreSQL suites: pg_financial_definitions, pg_tiffin_management, pg_settings_and_assignment, pg_beds_and_maintenance, pg_rent_generation, pg_order_lifecycle, pg_reports_and_admin. Updated: finance (mock query shape), pg_money_flows and task01b_52 (approval rule), pg_orders (migration count from journal), pg_delivery_operations (isolation from other suites' subscriptions), task01b_70 (Tiffin restored).
Results: see the final summary in the hand-over message (full sandboxed run on a fresh disposable PostgreSQL 16).

## 8. Known limitations
- Live updates are per server process (unchanged); settings are read from the database with a ≤10 s per-instance cache.
- No scheduler exists on the host, so automatic rent runs when the Owner/Manager opens the dashboard on or after the due day (or by hand).
- Occupancy history uses current room capacity for past months (capacity history is not recorded).
- A month already charged by hand is detected by charges dated in that month or with that month's label; other manual labels are not recognised.
- Email notifications were not added (no approved consumer); in-app alerts only. Push still needs Firebase.
- Pre-existing failing tests not caused by this work: `fixture_isolation_and_transaction_integrity` (6), `integration_audit` (1), `task01b_63` (3) — calendar-dependent, `task01b_68` (1) — expects no Android SDK. Same failures at the unmodified commit `a3a3ccc`.

## 9. Deferred
UI restructuring / design system; tiffin customer credit balances; email/SMS reminders; capacity history.
