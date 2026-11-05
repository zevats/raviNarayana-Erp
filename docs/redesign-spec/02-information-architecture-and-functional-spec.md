# Ravinarayan ERP — Information Architecture, Functional Specification, Dashboard and Roles

Deliverables 4, 5, 6 (page inventory), 7. Rules used: nothing here invents a business rule. Anything not already enforced by the code is marked **[DECISION]** (owner must confirm) or **[NEW]** (proposed, needs approval). Existing behaviour is marked **[EXISTS]**.

---

## 1. Final information architecture (Deliverable 4)

Principle: organise by daily job, keep every existing capability, and bring the orphaned Tiffin and Kitchen capabilities back under clear homes. Delivery staff keep their own app untouched.

```
Home
  Dashboard                       [EXISTS, redefined]
Operations
  Orders                          [EXISTS]  new order, list, order detail
  Delivery                        [EXISTS]  Board · Problems · Cash custody · History
  Kitchen                         [RETURN, DECISION 1]  Today's plan · Prep sheet · Stock · Recipes
Customers
  Residents                       [EXISTS]  list · profile · check-in · transfer · check-out
  Tiffin customers                [RETURN]  directory · subscriptions · billing
Property
  Rooms                           [EXISTS]  list · room detail · (beds, maintenance [DECISION 5])
Money
  Cashbook                        [EXISTS]  transactions
  Resident dues                   [EXISTS]  statements
  Invoices                        [EXISTS]
  Daily closing                   [EXISTS]
Insights
  Reports                         [EXPAND]  catalogue of real reports + exports
  Activity log                    [NEW]     Owner only
Admin
  Staff                           [EXISTS]  Owner only
  Settings                        [NEW]     Owner only
Account (header menu)             [EXISTS]  profile · password · email · devices · sign out
Notifications (header bell)       [EXISTS, expand]
```

Mobile (manager): bottom bar with Dashboard, Orders, Delivery, Residents, More. Sidebar groups collapse into "More". Delivery role: unchanged app.

### Module dependencies
Residents ← Rooms (stay needs a room). Rent/deposit/expenses → Cashbook ← Delivery collections ← Orders. Orders → Delivery tasks → Cash custody → Cashbook (on acceptance). Tiffin subscription → Orders/Delivery daily tasks (via `generateDeliveryTasks`) → Billing → Invoices → Cashbook. Kitchen plan ← Residents opted in + Subscriptions + Orders. Closing locks every finance write for a finalised date. Dashboard reads all.

---

## 2. Roles and permissions (existing, enforced server side)

| Area | Owner (SUPER_ADMIN) | Manager (OPERATIONS_MANAGER) | Delivery |
|---|---|---|---|
| Dashboard, Reports | yes | yes | no |
| Rooms | read, manage | read, manage | no |
| Residents (check-in/out, edit, KYC) | yes | yes | no |
| Finance: view | yes | yes | no |
| Finance: record rent/deposit/expense | yes | yes | no |
| Finance: reverse, invoices, closing finalize/reopen, tiffin billing | yes | **no** | no |
| Checkout settlement incl. refunds | yes | yes **[DECISION 4]** | no |
| Orders (create) | yes | yes | no |
| Delivery manage (assign, cancel, resolve, collect, accept cash) | yes (edit toggle) | yes | no |
| Delivery own stops, collect, declare cash | no | no | yes |
| Tiffin, Kitchen | yes | yes | no |
| Staff admin | yes | read only list | no |
| Audit log (`audit.read`) | yes | yes in permissions **[DECISION: show to Manager?]** | no |
| Settings | **[NEW]** yes | no | no |

UI hides what the role cannot use; the server remains the control. Legacy `ACCOUNTANT` and `KITCHEN_OPERATIONS` get no navigation and cannot be newly assigned.

---

## 3. Functional specification (Deliverable 5)

Each feature: purpose · workflow · validation · related modules · completion. Standard UI states unless noted: loading (skeleton, scooter loader for full page), empty, populated, validation error, submit error (message kept, entry kept), success (toast + updated record), confirmation for destructive actions, permission restricted (action hidden; direct URL redirects).

### 3.1 Resident registration and check-in **[EXISTS]**
Purpose: admit a resident and allocate a room. Entry: Residents → Add resident.
1. Enter name, phone (unique), email, emergency contact, notes. 2. Choose room (only active rooms with free capacity). 3. Enter check-in date (default business today), monthly rent (default room base rent), security deposit. 4. Server locks the room, re-checks capacity and that the resident has no active stay. 5. Creates stay; records the deposit transaction if deposit > 0; writes audit. 6. Opens profile.
Validation: duplicate phone; capacity; date not in a closed period for money rows; amounts integer ≥ 0.
Related: Rooms (occupancy), Cashbook (deposit), Kitchen (meal opt-in), Dashboard.
Complete when: stay visible in list and room, occupancy +1, deposit in cashbook, audit row, double-submit does not duplicate.

### 3.2 Room transfer and check-out **[EXISTS]**
Transfer: pick target room with capacity → one transaction closes old stay, opens new, carries deposit without re-billing. Check-out: preview shows rent dues, deposit, deductions → enter deductions and refund method → settlement row, deposit application (non-cash), refund (cash out), stay COMPLETED. Concurrency verified on PG. **[DECISION 4]** who may refund.

### 3.3 Rent and expenses **[EXISTS]**
Record rent charge (per resident, month), payment (cannot exceed charged), deposit, expense (division by category, optional receipt). Reversal Owner only. All blocked on a finalised closing date. **[DECISION 6]** whether monthly charges should be generated automatically; today manual.

### 3.4 Orders **[EXISTS]**
New order: choose Delivery or Dine-in → customer (search or create by phone, duplicates prevented) → items from active menu (server prices, monthly packages excluded) → address (delivery) → save with one idempotency key. Delivery creates a task auto-assigned to the default driver and dispatched. Dine-in posts a sale. List shows delivery state and payment state (Paid / Part paid / Unpaid / Nothing due). **[NEW, DECISION 3]** Edit/cancel rules. Until decided, "cancel" exists only at stop level.

### 3.5 Delivery management **[EXISTS]**
Manager can: generate resident tasks for a meal, assign/reassign (single and batch), dispatch, retry a failed stop, cancel (reason; after cut-off needs override), resolve an exception (how resolved), collect or complete on a driver's behalf, accept cash handover, export a day. Exclusive to the driver: mark delivered with per-item quantities from the field, declare handover. **[NEW]** timeline in the stop panel; driver filter; collection reconciliation; exception queue with age.

### 3.6 Tiffin customers and subscriptions **[RETURN, orphaned UI exists]**
Purpose: manage recurring customers. Directory (search, status, type, balance) → customer profile (addresses, instructions, diet) → subscription create (product, meal types LUNCH/DINNER/BOTH, service days, quantity per meal, start/end, price snapshot, address) → pause (dates, reason) / resume / cancel (reason). Daily task generation picks eligible subscriptions. Validation: one product per subscription, dates, price ≥ 0, cannot resume a cancelled one. Completion: a subscription created in UI appears in Orders → Subscriptions today and produces tasks. **[NEW]** expiry alert 7 days before `end_date`; renewal action. **[DECISION 2]**.

### 3.7 Tiffin billing **[RETURN]**
Preview period per customer → generate invoice → record payment → allocate. Prepaid exceptions list. Owner only. Closing locks apply.

### 3.8 Kitchen **[RETURN, DECISION 1]**
Demand for a date = opted-in residents + subscribers + party orders − opt-outs (formula already in service). Plan: draft → confirm → complete; adjustments; reconcile prepared vs delivered. Prep sheet printable. Stock: materials, receipts, waste, adjustments, movements; recipes (BOM) deduct stock on completion; consumption preview/confirm/reverse. **[NEW]** low-stock flag only if the material has a defined reorder level (field absent today → would need a column; do not invent).

### 3.9 Cashbook, dues, invoices, closing **[EXISTS]**
Keep workflows. Redesign only layout. Daily closing: preview expected cash per division, enter physical count, variance requires reason, finalise snapshot locks the date, reopen Owner only.

### 3.10 Staff **[EXISTS]**; Settings **[NEW]**
Staff: create (canonical roles), role change, deactivate (revokes sessions), reset/recovery link, history; sole Owner is protected. Settings (Owner): business name/contact (used on invoices and emails), meal timings and cancellation cut-off (currently in code), default delivery driver (replaces env var), notification channels, rent due day (if DECISION 6). Every setting must be stored in a new `settings` table; no setting is added that the code does not read.

### 3.11 Activity log **[NEW]**
Read-only list of `audit_logs`: when, who, action, target, outcome; filters by user, action, date; click a row to see details. Owner only (Manager by DECISION). No edit/delete.

### 3.12 Notifications **[EXISTS, expand]**
Keep the six derived alerts. **[NEW]** subscription expiring, pending settlement (handover declared, not accepted), closing not finalised for yesterday. Each links to the record.

---

## 4. Page inventory (Deliverable 6)

| # | Screen | Roles | States to design |
|---|---|---|---|
| 1 | Login | all | default, field errors, wrong password, sending code, code step, wrong/expired code, inactive, offline/503, session expired notice |
| 2 | Forgot / reset password | all | request, sent, invalid/used link, success |
| 3 | Dashboard | O, M | loading, populated, partial failure notice, empty (new tenant) |
| 4 | Orders list + new order sheet | O, M | empty, filters, saving, error |
| 5 | Order detail | O, M | delivered/partial/not delivered, payment states |
| 6 | Delivery · Board | O, M | empty day, stops by status, bulk selection, stop panel (assign/retry/cancel/resolve/collect) |
| 7 | Delivery · Problems | O, M | empty, list |
| 8 | Delivery · Cash custody | O, M | per driver, declared handovers, accept |
| 9 | Delivery · History + export | O, M | filters, empty |
| 10 | Kitchen · Plan / Prep sheet / Stock / Recipes | O, M | draft, confirmed, completed |
| 11 | Residents list | O, M | empty, search, filters |
| 12 | Resident profile (stays, dues, documents, settlements) | O, M | |
| 13 | Check-in, Transfer, Check-out sheets | O, M | preview, confirm |
| 14 | Tiffin customers · list, profile | O, M | |
| 15 | Subscription create/edit, pause, cancel | O, M | |
| 16 | Tiffin billing | O | preview, generated |
| 17 | Rooms list, room detail | O, M | |
| 18 | Cashbook, Resident dues, Invoices, Daily closing | O (M view/record) | closed day, reopen confirm |
| 19 | Reports | O, M | |
| 20 | Activity log | O | |
| 21 | Staff list, create, edit, history | O | |
| 22 | Settings | O | |
| 23 | Account (profile, password, email, devices) | all | |
| 24 | Notifications panel | O, M | |
| 25 | Error, 404, offline, no-access | all | |
| 26 | Download app page | public | |

---

## 5. Dashboard and analytics specification (Deliverable 7)

Rule: every number comes from a query on real tables; a failed query shows an explicit notice (existing behaviour), never zero. Dates use the business date (IST), not UTC. Division filter (Combined / PG / Tiffin) applies where money is involved. Real time = recalculated on change signal; otherwise refreshed on view.

### Today strip (decisions for the day)
| Metric | Formula | Source | Action on click |
|---|---|---|---|
| Stops waiting | `delivery_tasks` today, status PENDING/unassigned | delivery_tasks | opens Board filtered Waiting |
| Out for delivery | status DISPATCHED/IN_TRANSIT | delivery_tasks | Board filtered Out |
| Delivered / total, completion % | delivered ÷ (total − cancelled) | delivery_tasks | Board |
| Problems | tasks with exception, not resolved | delivery_tasks | Problems tab |
| Cash with drivers (not yet handed over) | Σ collected_amount where `handover_id` is null and method CASH | delivery_tasks | Cash custody |
| Meals expected today (lunch / dinner) | kitchen demand formula; fall back to orders + subscriptions if no plan | daily_meal_plans, subscriptions, orders | Kitchen/Orders |

### Property and people
| Metric | Formula | Source |
|---|---|---|
| Occupancy % | active stays ÷ total capacity of active rooms | resident_stays, rooms |
| Vacant beds | capacity − active stays | same |
| Active residents | status ACTIVE | residents |
| Residents with dues | per resident Σ rent charged − paid > 0 | financial_transactions |
| Dues total | Σ of the above, per resident (not netted across residents) | same |
| Deposits held | Σ security_deposit of ACTIVE stays minus applied/refunded **[DECISION 8]** | resident_stays, ledger |

### Money
Collected this month (rent + tiffin + delivery cash/UPI accepted), Expenses this month, Net, Cash-in-hand today (from closing preview), Last closed day and whether yesterday is unclosed. Each opens Cashbook with the same period. Charts (all defined, none decorative): 6-month collected vs expenses (exists); daily collections last 30 days; delivery completion % by day last 14 days; expense by category this month (needs `category`, present). Occupancy trend is **not** drawn until stays history snapshots are queried explicitly (derive from `check_in_date`/`check_out_date`; allowed, but must be defined as active-on-date counts).

### Not shown
Profit and loss beyond collected vs expenses (no accounting basis for accruals), meal-demand trend before kitchen plans are in use, any benchmark or target (none stored).

### Reports (Deliverable 7 catalogue)
Daily closing summary; Rent collection and dues by month; Occupancy and vacancy; Resident ledger (exists); Expense by category/vendor; Tiffin revenue by customer/product; Delivery by day/driver (completion, undelivered reasons, collected vs expected); Cash custody and variance; Outstanding balances (residents + tiffin). Each: date range, division, CSV export (formula-injection safe, existing), and row drill-down to source records.
