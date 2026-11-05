# ERP feature analysis: Pay Later, unified receivables, delivery payment options and UI audit

Date: 2026-11-04. Status: **analysis only.** No application code, schema, migration, `.env.local`, Neon or local database was changed. The only database writes were long-data test records added through the app's own API to the throwaway `rn_erp_verify_e2e_test` database (§11).

> **Update 2026-11-05:** P0 (§2) and P1–P2 (Pay Later, payment choice at the door, Receivables, statements, Receive payment, Cashbook refund lines) are now implemented and tested on disposable databases, not yet released. See `docs/P0_FINANCIAL_INTEGRITY_FIXES_2026-11.md` and `docs/FINANCIAL_SYSTEM_IMPLEMENTATION_P0_P2_2026-11.md`. Decisions D1–D9 were applied as recommended; D10–D14 remain open. P3 (global loading redesign) and P4 are not started.

**How this was built.** Every statement below comes from reading the current source (working tree, including the uncommitted performance work), the Drizzle schema, the SQL migrations `0000`–`0019`, and the project documents `PROJECT_REQUIREMENTS.md`, `ARCHITECTURE_AND_DECISIONS.md` and `FINANCIAL_DEFINITIONS.md`. Three findings were also confirmed by running something, and are marked **(verified)**: an SQL reproduction on literal values, the long-data layout audit, and the earlier duplicate-submission audit. Everything else is **(from source)**.

**The short version:**

- **PG residents already have "pay later".** Rent is a ledger account: charges minus payments, with partial payments, a cap at the amount owed, reversals and statements.
- **Delivery orders already allow a balance.** A driver can collect ₹0 up to the amount due, and the rest stays as a balance on the order. But nobody chooses "Pay Later" explicitly. There is no eligibility control. The balance is visible only one day at a time. It is not part of any customer account or outstanding report.
- **Tiffin subscriptions are already billed monthly**, so they are post-paid by design. What's missing:
  - a customer-level statement with carry-forward;
  - a daily breakdown on the invoice;
  - a single payment entry point;
  - fixes for two balance bugs.
- **Recommended architecture:** keep the three existing sources of truth and add a read-only unified Receivables view over them. Don't copy delivery balances into the general ledger.
  - The rent ledger (residents).
  - The tiffin ledger and invoices (subscriptions).
  - The order with its delivery collections (doorstep orders). This is exactly what the approved ADR-05 and requirement §7.3 describe.
- **Smallest safe sequence:**
  1. Six correctness fixes that need **no migration** (P0).
  2. One small additive migration for invoice idempotency (P0, needs your approval).
  3. One small additive migration for Pay Later fields on orders and customers (P1).
  4. Then the Receivables page (P2) and the loading and layout work (P3).

---

## 1. Existing feature inventory

Classification key:

- **W** — fully implemented and working.
- **P** — partially implemented.
- **U** — present in the UI but not functional.
- **D** — duplicated.
- **M** — missing.
- **X** — unnecessary or confusing.

"Verified" means it was exercised in the browser workflow suite (125/125) or the 251-control inventory on 4 Nov.

### 1.1 Modules and navigation (manager ERP)

| Section (route) | Theme | Sub-pages / tabs | Server modules | Status |
|---|---|---|---|---|
| Dashboard `/dashboard` | green | KPI tiles, collections chart, monthly revenue, recent transactions, needs attention, export | `server/dashboard/*`, `rentGenerationService.runAutomaticRentIfDue` | W (verified) |
| Rooms `/rooms` | green | Rooms grid, beds, maintenance, room detail, checked-out residents | `server/rooms/*` (`room_beds`, `room_maintenance` from 0017) | W (verified) |
| Residents `/residents` | green | Directory, check-in, check-out with settlement, transfer, settlement approvals | `server/residents/*` (`resident_settlements`, `settlement_proposals` from 0018) | W (verified) |
| Orders `/orders` | orange | Day list (60 per page), new order, edit (revisions), cancel | `server/orders/orderService.ts`, `orderLifecycleService.ts` | W (verified) |
| Delivery `/delivery` | orange | Board, problems, custody, history, menu, subscriptions today, residents today | `server/delivery/deliveryService.ts` (3,634 lines), `deliveryOps.ts` | W (verified) |
| Tiffin `/tiffin` | green | Customers, Subscriptions, Menu & prices, Billing (Owner) | `server/tiffin/tiffinService.ts`, `tiffinBillingService.ts` | W, with gaps in §3 |
| Finance `/finance` | green | Cashbook, Resident dues, Invoices, Daily closing | `server/finance/*` | W, with gaps in §6–§9 |
| Reports `/reports` | green | 9 reports, including "Outstanding balances" and "Deliveries" | `server/reports/reportsService.ts`, `businessReportingService.ts` | W; outstanding excludes order balances |
| Activity, Staff, Settings, Notifications, My account | green | — | audit, staff, settings, notifications, account | W (verified) |
| Kitchen `/kitchen` | — | redirects to Orders | `server/kitchen/*` (dormant) | Dormant by decision; kept |

**Delivery staff app** (`DeliveryStaffShell`, `StaffDelivery`, `DeliverySheet`, `StaffCash`, `StaffHistory`, `offlineQueue.ts`):

- **Works (verified):** today's stops, the delivery form, not-delivered, cash handover and history.
- **Android:** a Capacitor shell that loads the hosted site (`mobile/capacitor.config.json` points `server.url` at the Render URL). Delivery-screen changes ship with a web deploy and need **no APK rebuild**.

### 1.2 Roles and permissions (`server/authorization/permissions.ts`)

| Role | Assignable now | Money permissions | Notes |
|---|---|---|---|
| SUPER_ADMIN (Owner) | yes | `finance.read`, `finance.record`, `finance.manage` | Only role that can reverse, issue or cancel invoices, allocate, finalise closings, run tiffin billing and record **tiffin** payments |
| OPERATIONS_MANAGER | yes | `finance.read`, `finance.record` | Can charge rent, take rent payments, deposits and expenses, and run the rent run. **Cannot record a tiffin payment** (`recordTiffinPayment` needs `finance.manage`). Can collect an order balance (`delivery.update`). |
| DELIVERY_PERSON | yes | `delivery.read`, `delivery.update` | Can complete and collect only on tasks assigned to them (ownership check in every service function) |
| ACCOUNTANT, KITCHEN_OPERATIONS | legacy only | Accountant has `finance.manage` | Cannot be newly assigned |

### 1.3 Finance and billing: what exists

| Capability | Where | Status | Evidence |
|---|---|---|---|
| Rent charges, manual and automatic monthly run, prorated by nights | `financeService.recordRentCharge`, `rentGenerationService` | W | Idempotent per stay and month (`autoKey`), lock `rent-run:<month>`, owner decision 2026-11-01 on proration |
| Rent payments, partial | `recordRentPayment` | W | Capped at the outstanding balance and re-checked under a per-resident lock. **Advance payment is refused.** |
| Deposits, deposit applied to rent, refunds, checkout settlement with approvals | `recordSecurityDeposit`, `residentSettlements`, `settlement_proposals` | W | — |
| Reversals (dated today; same- and cross-period rules) | `reverseTransaction` | W | Accounting scenarios in the previous audit §11 |
| Resident balance and statement | `getResidentFinancialSummary`, Finance → Resident dues, `ResidentStatementsView` | W | Balance = Σ RENT_CHARGE − Σ RENT_PAYMENT (posted) |
| Tiffin subscription billing (preview → generate → issue) | `tiffinBillingService` | W | One invoice per customer, subscription and period. Race fixed in the previous audit (`tiffin-billing:<period>` lock). Delivered tasks are stamped `invoice_id` so they are never billed twice. |
| Tiffin payments, idempotent | `recordTiffinPayment` | W | No cap: an amount above what's owed becomes unallocated credit |
| Invoices (draft, issue with yearly gapless number, allocate, cancel, print) | `invoiceService`, `PrintableInvoiceModal` | P | See P0 items 2–4 and the duplicate gap (§8) |
| Invoice ageing (current, 1–30, 31–60, 61–90, 90+) | `businessReportingService.getInvoiceAgeingReport` | W (invoices only) | — |
| Outstanding balances report | `reportsService` "outstanding" | P | Rent from the ledger plus tiffin from **invoices**. **No order balances.** |
| Daily closing (PG / TIFFIN / COMBINED; finalisation locks) | `cashbookClosingService` | W | — |
| Delivery custody ledger (`delivery_collections`, handovers declare/accept) | `deliveryService` (migration 0013) | W | Cash enters the cashbook when a handover is accepted, as one `TIFFIN_PAYMENT` per handover with **no customer**. UPI is booked at once (owner decision, round 13), also with no customer. |
| Order balance ("UNPAID ₹x"), collect balance later | Orders page; Delivery task panel; `collectOrderBalance` | P | Per day only; see §5 |
| Explicit Pay Later choice, eligibility, cross-day receivables, ageing for orders | — | **M** | — |
| Customer account statement (tiffin + orders) with carry-forward | — | **M** | — |
| UPI "pending verification" state | — | **M** | UPI is trusted and booked directly by design |
| Credit limit | — | **M** | The requirements mention "agreed billing credit terms" (§4.1) but define no limit |
| Additional PG charge types (electricity, damages…) | — | **M** | Rent charges are fixed to category `RENT`. Checkout deductions are the only other charge. |

### 1.4 Things in the code that are unused, misleading or duplicated

| Item | Class | Detail | Recommendation |
|---|---|---|---|
| `modules/delivery/components/modals/SingleScreenDeliveryModal.tsx` (448 lines) | X | Not imported anywhere; replaced by `DeliverySheet` | Remove in the delivery change (needs your approval because it is delivery code) |
| `OVERDUE` invoice status in two report queries | U | The `chk_invoices_status` constraint does not allow `OVERDUE`, so that branch can never match | Derive "overdue" from `due_date` instead (§7); delete the dead value |
| Offline action `RECORD_COLLECTION` | U | Sanitiser and server sync support it, but no screen enqueues it | Use it for the driver's "collect balance later" if you approve that (§5.E) |
| Driver filter "Collect Cash/UPI" | X | Lists stops with a balance, but the driver has no action to record a later payment there | Decide: give the driver a "Collect balance" action, or rename the filter |
| Balance formulas | D | Resident balance is computed in `getResidentRentBalance`, `getResidentFinancialSummary`, `financialDefinitions.getOutstandingRent` and the reports, with slightly different payment filters (`RENT_SETTLEMENT_SQL` vs all `RENT_PAYMENT`) | One shared definition per account type (§6) |
| Tiffin outstanding on two bases | D | The tiffin balance modal uses ledger charges minus payments. The outstanding report uses invoice `balance_due`. They differ whenever a payment is not allocated. | Account balance from the ledger; invoice status from allocations (§6) |
| Walk-in sale (Kitchen module) vs Dine-in order | D | Kitchen is dormant; Dine-in orders replace it | Keep dormant; no action |

---

## 2. Missing and duplicate functionality (summary)

Ordered by risk:

1. **Correctness defects in existing money code**, all fixable without a migration (P0):
   1. **(verified)** The tiffin "unallocated payments" figure double-counts a payment that has two or more allocations. `getTiffinCustomerBalance` joins payments to allocations and sums `t.amount` per joined row. Reproduced on literal values in PostgreSQL: a ₹1,000 payment allocated ₹300 + ₹200 shows **₹1,500 unallocated; correct ₹500**.
   2. **(from source)** `allocatePaymentToInvoice` reads the invoice and the payment's remaining amount **outside** the transaction, without a lock, then writes `amount_paid`/`balance_due` from those stale values. Two allocations at the same moment can over-allocate a payment or lose one invoice update. The `balance_due >= 0` check only stops the extreme case.
   3. **(from source)** Issuing a **resident** invoice links an existing rent charge only when the free-text `billing_period` matches exactly; otherwise it posts a **new** `RENT_CHARGE`.
      - The rent run writes "November 2026" (`en-IN`).
      - The invoice form defaults to the browser's locale month name and is editable.
      - A typed "Nov 2026" or a non-English browser therefore charges the resident twice.
   4. **(from source)** The generic Cashbook reversal accepts any `TIFFIN_PAYMENT`, including delivery collections (category `TIFFIN_DELIVERY_COLLECTION`). It updates only invoice allocations; the `delivery_collections` row, the task's `collected_amount` and the order's balance stay unchanged, so the order still shows "paid".
   5. **(from source)** The manager's "Collect balance" (Delivery task panel) makes a new idempotency key on every click (`bal_<task>_<Date.now()>`) and guards only with React state. Two same-instant activations can record two partial collections. The server lock still caps the total at the amount due.
   6. **(from source)** Reversing an allocated payment **deletes** its `invoice_payment_allocations` rows. The audit log keeps an entry, but the allocation history is gone from the data (rule 6).
2. **Invoice duplicates (verified in the previous audit):** two identical "create invoice" requests at the same instant create two invoices, and issued ones create two charges. The fix needs an idempotency column (migration).
3. **Pay Later for delivery orders is implicit:**
   - A ₹0 entry looks the same as "forgot to collect".
   - Any driver can leave any customer with a balance.
   - There is no cross-day list, no ageing and no customer account view, and the balance is missing from the Outstanding report.
4. **No unified "who owes what"** across rent, tiffin invoices and order balances.
5. **Tiffin invoices:**
   - one line per subscription ("N delivered meals"), with no day-by-day breakdown;
   - no previous balance or payments-received context;
   - the Manager cannot record a tiffin payment.
6. **Loading:** pages that fetch on the client show the destination skeleton, then a centred scooter or house loader, then content. The dashboard skeleton is four generic tiles. The green-section loader is a slow brick-by-brick house (§13).
7. **Layout with real long data:** see §11.

---

## 3. Tiffin Pay Later architecture

### 3.1 How tiffin works today (from source)

- **Consumption** is recorded as delivery tasks per subscription per meal (`delivery_tasks.subscription_id`). Since migration 0014, item lines (`delivery_task_items`) record the boxes actually delivered.
- **Pricing:** the agreed price is a snapshot on the subscription (`tiffin_subscriptions.price`). The billing unit comes from the product (`PER_MEAL`, `PER_DAY`, `PER_MONTH`…).
- **Monthly billing** (`previewTiffinBilling` → `generateTiffinInvoices`):
  - **per meal:** delivered boxes × agreed price;
  - **per month:** the full agreed price (only a warning if nothing was delivered; **no proration or pause credit**, still an open owner decision, §16 #3 of the requirements);
  - one invoice per (customer, subscription, period); delivered tasks are stamped with the invoice, so a task is never billed twice;
  - **auto-issue** posts a `TIFFIN_CHARGE` with `customer_id`.
- **Payments:** `TIFFIN_PAYMENT` with `customer_id`, idempotent, optional allocation to an invoice. No cap.
- **Balance:** Σ `TIFFIN_CHARGE` − Σ `TIFFIN_PAYMENT` per customer, **floored at ₹0** (an advance is hidden).

**Conclusion:** subscription customers already consume first and pay later, by design. A "Pay Later toggle" is not needed for subscriptions. It matters for **ad-hoc delivery orders** placed for tiffin customers (§5), which use the same customer record (`orders.customer_id → tiffin_customers`).

### 3.2 Can existing consumption records support Pay Later without duplicate charges?

Yes:

- **Subscription meals** are protected by `delivery_tasks.invoice_id` (set when billed, cleared when the invoice is cancelled) plus the period lock and the one-invoice-per-subscription-period rule.
- **Ad-hoc orders** are never billed through tiffin invoices today. Their money is collected against the order (`delivery_collections`).

As long as order balances stay on the order (§5–§6) and are **not** also rolled into a tiffin invoice, nothing is counted twice.

### 3.3 Proposed flow

| Requirement | Existing | Gap | Proposal | Migration |
|---|---|---|---|---|
| 1. Manager enables or disables Pay Later per customer | — | Missing | `tiffin_customers.pay_later_enabled` toggle on the customer form, Owner and Manager; audited | Yes (0021, additive) |
| 2. Consumption recorded without immediate payment | Subscriptions: yes. Orders: yes (balance). | No explicit choice for orders | §5 | Yes (0021) |
| 3. Unpaid charges add to the customer's outstanding | Subscriptions via the invoice ledger; orders via the order balance | Not combined | Customer balance = tiffin ledger balance + Σ open order balances (§6) | No |
| 4. Partial payments | Yes (tiffin payment, order collection) | Two separate entry points; Manager cannot record a tiffin payment | One "Receive payment" on the customer account that splits across open items, oldest first (§6.4); grant the Manager this action (decision D6) | No |
| 5. Each payment reduces the balance | Yes per path | Unallocated double-count bug | P0 fix 1 | No |
| 6. Continue accumulating per account rules | Unlimited today | No limit | Credit limit only if you decide one (D2) | Only if a limit is chosen |
| 7. Monthly invoice at period end | Yes (subscriptions) | Single summary line | Keep the invoice as the period charge. Add a printable **daily breakdown**, built from the tasks already linked to the invoice (`delivery_tasks.invoice_id`), so no new rows are stored. | No |
| 8. Detailed consumption breakdown | Data exists (tasks + item lines) | Not shown | As above | No |
| 9. Previous unpaid balances carry forward | No | Missing | A **customer statement** (opening balance, period charges, payments, closing balance) rather than a "previous balance" line on the invoice, so invoices are never summed twice (§7.3) | No |
| 10. Who owes, for which period | Partly (Outstanding report: tiffin invoices) | Orders missing; no ageing for orders | Receivables page (§6) | No |

### 3.4 Tiffin invoice content

**Already stored:**
- customer name, phone and address;
- billing period, issue date and due date;
- invoice number (gapless per year, assigned at issue);
- type (Regular bill / GST tax invoice);
- line: description, quantity, unit price, amount;
- total, amount paid, balance due, status (Draft / Issued / Partially paid / Paid / Cancelled);
- company block and notes.

**Proposed for the printable view (computed, not stored):**
- day-by-day consumption: date, meal, boxes, rate, amount;
- payments allocated to this invoice: date, method, amount;
- "Overdue" when `balance_due > 0` and `due_date` is past.

**Previous balance and payments received in the period belong on the statement, not the invoice** (§7.3).

**Tax:** no change. The code already supports Regular bills, and GST invoices only when a company GSTIN is configured; tax rates are 0 on tiffin lines today. GST treatment is open owner decision §16 #5 of the requirements; nothing here invents one.

---

## 4. PG Pay Later architecture

### 4.1 Existing (from source)

PG residents already work on an account basis. **Nothing needs rebuilding.**

| Need | Existing implementation |
|---|---|
| Monthly rent charges | Rent run (manual or automatic on the configured due day), prorated by nights, idempotent per stay and month. Check-out or transfer replaces the month's automatic charge with the nights actually stayed (`settleAutomaticRentOnStayEnd`). |
| Partial and later payments | `RENT_PAYMENT` of any amount up to the outstanding balance, at any time, locked per resident |
| Unpaid rent | Outstanding = Σ posted charges − Σ posted settlements (`financialDefinitions.getOutstandingRent`) |
| Deposits, applied deposit, refunds | `SECURITY_DEPOSIT`, `RENT_PAYMENT` (category `DEPOSIT_APPLICATION`), `DEPOSIT_REFUND`; checkout settlement with Manager-proposal / Owner-approval (0018) |
| Credits and adjustments | Reversals only (dated today). There is no manual credit note. |
| Carry-forward | Implicit: the balance is cumulative |
| Monthly invoices | Manual resident invoices (draft → issue) linking or posting the rent charge |
| History and statements | Resident dues tab, resident statement, "Resident ledger" report with running balance |

### 4.2 Gaps and proposals

| Gap | Proposal | Files | DB | Migration |
|---|---|---|---|---|
| Free-text period can double-charge at invoice issue (P0 #3) | When issuing a resident invoice, find unlinked rent charges for the **same month** by `transaction_date`, the `autoKey` month or the period label, and link one; if several, ask which. Never post a second charge for a month that already has one unless the Owner confirms "additional charge". | `invoiceService.issueInvoice`, `CreateInvoiceModal` | none | No |
| No ageing for resident dues | FIFO ageing: apply settlements to the oldest charges first; age each remaining charge from its date. Same buckets as the invoice ageing report. | new read service | none | No |
| Statement with opening and closing balance | Resident statement already lists entries with a running balance; add opening balance for a chosen period and a printable view | `ResidentStatementsView`, reports | none | No |
| Additional charge types | Only if you decide (D12). Option: keep `RENT_CHARGE` with a new category (electricity, damage…). `category` has no CHECK, so no migration, but reports must then split "rent" from "other charges". | finance service, reports | none | No |
| Advance rent | Refused today. Keep unless you decide otherwise (D8). | — | — | — |
| Manual credit note | Not present; reversal plus re-entry covers corrections. Recommend not adding until a real case appears (§16). | — | — | — |

**Proration:** unchanged. The owner decision of 2026-11-01 (monthly rent × nights ÷ days in month) is preserved; nothing in this proposal touches rent calculation.

---

## 5. Delivery-boy Cash / UPI / Pay Later architecture

### 5.1 Today, exactly (from source)

**Completion form (`DeliverySheet.tsx`, shared by the driver phone sheet and the manager panel):**
- the per-line delivered quantity;
- "Handed over to";
- for doorstep orders only (`paymentMode === "DOORSTEP"`; subscription and resident meals take no payment): **Due / Collecting / Balance**, an amount box **pre-filled with the full amount due**, and a **Cash / UPI** toggle (default Cash).

**Server (`completeLinedDelivery`):**
- **Amount due** = Σ delivered × saved unit price, computed on the server and never taken from the browser.
- **Collected** must be 0 … amount due.
- If collected > 0: one `delivery_collections` row in the custody of the assigned driver. UPI (non-cash) is also booked at once as a `TIFFIN_PAYMENT` (category `TIFFIN_DELIVERY_COLLECTION`, `customer_id` NULL), with a closing-lock check.
- **Balance** = due − collected; it is never written anywhere as a receivable. It is recomputed when the task is read (`attachOrderData`).
- The order becomes `COMPLETED` once something is delivered.
- **Idempotent:** the status guard (`WHERE status NOT IN ('DELIVERED','EXCEPTION','CANCELLED')`) plus one key per opened form.

**Later payment:**
- `POST /api/delivery/tasks/[id]/collect` → `collectOrderBalance`: task row locked `FOR UPDATE`, total re-read, capped at the amount due, credited to whoever records it.
- Used only by the manager's task panel. The driver app has no such action.

**Offline (`offlineQueue.ts` + `syncDeliveryActions`):**
- The queue is in localStorage, owned by the staff member who queued it; 5 retries.
- The sanitiser keeps `collectedAmount > 0` and `paymentMethod ∈ {CASH, UPI}` only.
- On sync: an action from another account is refused, as is a task reassigned to someone else. "Already delivered" is treated as an idempotent no-op.
- `completeDeliveryTask` is replayed with the **same idempotency key**.

**Custody and cashbook:**
- Cash stays with the driver until a handover is declared and accepted. Acceptance posts one `TIFFIN_PAYMENT` per handover with no customer.
- UPI is excluded from custody (`transaction_id IS NOT NULL`).

**What "Pay Later" is today:** the driver changes the pre-filled amount to 0. The order is delivered, collected ₹0, balance = full amount, and appears as "UNPAID ₹x" on that day's Orders list and the Delivery board.

### 5.2 Proposed design

**A. Payment selection (driver form, orange theme, existing language):**

- A three-way choice in the existing radiogroup style, with `h-12` targets as the other choices on the sheet:
  - **Cash**
  - **UPI**
  - **Pay Later** (shown only when the customer is eligible)
- **Cash / UPI:** today's behaviour unchanged. The amount is pre-filled with the amount due and can be lowered for a part payment; a remainder is treated as Pay Later (see C).
- **Pay Later:** the amount box hides, Collecting shows ₹0, Balance shows the full amount due, and the confirm button reads "Mark as delivered, pay later".
- Theme: orange tokens only (`#C9501C` family, as in `DeliverySheet`). No green.

**B. Eligibility and controls (recommended policy):**

- **Pay Later is allowed only for customers a Manager or the Owner has approved** (`tiffin_customers.pay_later_enabled`).
- The driver can never approve, see or change it. Following ADR-05, the driver also never sees the customer's outstanding total.
- The task payload carries one boolean, `payLaterAllowed`, computed on the server when the stop list is loaded.
- **The server re-checks on completion.** If the customer is not eligible, it does **not** reject the delivery (the food has been handed over, and rejecting would lose a real event). Instead it:
  - records the delivery;
  - marks the order `UNPAID` with `pay_later_unapproved = 1`;
  - raises a manager notification ("Pay Later used for a customer without approval").

  Nothing is treated as paid, and nothing escapes the manager. This also covers an offline completion synced after eligibility was revoked. **Decision D3/D4.**
- **Credit limit:** none is defined in any rule. Recommendation: start without a limit, and show each customer's outstanding and oldest unpaid date to managers. If you want a limit, the server check becomes "outstanding + this order ≤ limit"; above it, the same flag-not-reject behaviour applies. **Decision D2.**
- **Short collections:** today a driver can collect less than due for anyone, which bypasses any Pay Later restriction. Recommendation: a remainder after Cash/UPI counts as Pay Later and follows the same eligibility rule. **Decision D3.**

**C. Order status vs payment status (no overloading):**

| Concept | Field (existing / proposed) | Values |
|---|---|---|
| Order lifecycle | `orders.status` (existing) | CONFIRMED → COMPLETED, or CANCELLED |
| Delivery progress | `delivery_tasks.status` (existing) | PENDING, ASSIGNED, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION, CANCELLED |
| Cash custody | `delivery_tasks.collection_status` (existing) | NONE, COLLECTED, HANDED_OVER |
| **Payment outcome chosen at the door** | `orders.payment_choice` (**new**, nullable) | CASH, UPI, PAY_LATER; NULL for legacy and not-yet-delivered |
| **Settlement state** | `orders.payment_status` (**new**) | NOT_DUE (not delivered / cancelled), UNPAID, PARTIALLY_PAID, PAID |
| Amounts | `orders.amount_due` (**new**, set at completion), `orders.amount_collected` (**new**, maintained with each collection in the same transaction) | integers ₹ |
| Returned / not delivered | existing per-line dispositions (RETURNED / WITH_STAFF / DISCARDED) and task EXCEPTION | unchanged |
| Pending verification | — | Not added: UPI is trusted and booked directly by your round-13 decision |

**Backward compatibility:**
- New columns are nullable or defaulted.
- Existing delivered orders are backfilled by an idempotent application script (the project's convention, like `backfillLegacyOrders`), never inside the migration: `amount_due` from `order_items.delivered_quantity × unit_price`, `amount_collected` from `delivery_collections`, `payment_status` from the two.
- Existing unpaid delivered orders then appear as `UNPAID`, which they already are on screen.

**D. Manager visibility:**

A **Pay Later / unpaid orders** list (in the Receivables page, §6, and as a filter chip on the Delivery board and Orders) with:

- order reference, customer name and phone (managers already see these), delivery person, delivery date;
- amount due, collected, outstanding;
- payment choice and payment status;
- age in days, using the existing buckets;
- a link to the customer account.

Filters: Pay Later / Cash / UPI / Unpaid / Partially paid / Unapproved.

Orders have no human-readable number today (screens use customer, date and meal). Options: show a short reference derived from the id (no migration), or add a sequential `order_no` (migration). **Decision D11.**

**E. Later collection:**

- **Office:** reuse `collectOrderBalance` (already locked, capped and idempotent by key), from the Receivables page or the customer account, by Owner or Manager. Payment methods are the existing canonical set (Cash, UPI, Bank transfer, Cheque, Other). No payment gateway.
- **Door (optional):** let the assigned driver record a later collection from the existing "Collect Cash/UPI" filter, using the existing unused offline action `RECORD_COLLECTION`. **Decision D6.**
- **Settlement:** partial payments leave the rest outstanding; a full payment sets `payment_status = PAID`.

**F. Offline behaviour:**

- The queued `COMPLETE_DELIVERY` payload adds `paymentChoice`. The sanitiser must accept `PAY_LATER`; today it would silently drop any value other than CASH/UPI, so this change is required.
- **No duplicate receivable is possible.** The receivable is a **state on the order row** (`payment_status`, `amount_due`), not an inserted row. A replay hits the existing status guard (already DELIVERED → `IDEMPOTENT_IGNORED`) and changes nothing. This is the main reason to prefer the order-state design over inserting ledger rows.
- The choice survives retries because it travels in the same queued payload under the same key.
- Delayed acknowledgement: the phone shows "Saved on this phone" as today; the server decides eligibility at apply time (B).
- **Legacy payload** (queued before the deploy, no `paymentChoice`): collected > 0 → CASH/UPI as sent; collected 0 with an amount due → `payment_choice = NULL`, `payment_status = UNPAID`, flagged for review. Nothing is assumed paid.
- Cash and UPI paths are unchanged.

**G. Audit and restrictions:**

| Question | Today (from source) | Proposal |
|---|---|---|
| Driver changes the payment method after completion? | Not possible (status guard) | Keep |
| Manager corrects a wrong collection? | Only by reversing the ledger row, which leaves the delivery record inconsistent (P0 #4) | P0: block that reversal. P2: a manager-only "Correct collection" that adds a dated correction and keeps the original (needs `delivery_collections.status` or a correction row; migration). |
| Payment recorded twice? | Completion: once (guard + key). Later collect: capped at due under a lock, but per-click key (P0 #5). | P0 #5 fix |
| Pay Later counted in cash handover? | No. Custody rows exist only when collected > 0. | Keep; add a test |
| UPI in cash totals? | No (custody splits CASH vs non-CASH; direct UPI excluded) | Keep; add a test |
| Delivered and unpaid without manager visibility? | Visible only on that day's lists | Receivables list + ageing (§6) |
| Audit entries | `delivery.task_delivered` carries `amountDue`, `collectedAmount`, `paymentMethod`, `balanceDue` | Add `paymentChoice`, `payLaterAllowed`, `payLaterUnapproved` |

---

## 6. Unified receivables architecture

### 6.1 Recommendation

**One new read-only page, Finance → Receivables** (a tab next to Cashbook, Resident dues, Invoices and Daily closing; green theme), plus links from the PG, Tiffin and Delivery screens into it. No receivable data is copied. It reads three sources, each the existing source of truth:

| Source | Account | Balance definition (one shared function each) | Traceable to |
|---|---|---|---|
| PG | Resident | Σ posted `RENT_CHARGE` − Σ posted rent settlements (`RENT_SETTLEMENT_SQL`), per resident, only residents who owe | each rent charge (and its invoice, if any) |
| Tiffin subscriptions | Tiffin customer | Σ posted `TIFFIN_CHARGE` − Σ posted customer-linked `TIFFIN_PAYMENT`; invoice `balance_due` for which-invoice detail | each tiffin invoice and its delivered meals |
| Doorstep orders | Tiffin customer (`orders.customer_id`) | Σ (`amount_due` − `amount_collected`) for delivered orders with `payment_status IN (UNPAID, PARTIALLY_PAID)` | each order and its delivery task |

**Why not post order receivables into `financial_transactions`:**
- ADR-05 (approved) says delivery is decoupled from the finance ledger and deferred amounts are receivables linked to the order ID.
- Requirement §7.3 says never record deferred amounts as cashbook collections.
- Delivery cash enters the ledger as one lump per handover with no customer. A ledger-side order receivable could therefore never be settled per customer without rebuilding the custody flow.

**Contents:**

- **Header totals:** PG, Tiffin (invoices), Orders, Total; counts of accounts owing.
- **Tabs:**
  - **By account:** resident or customer, the three components, oldest unpaid date, ageing bucket.
  - **Unpaid orders:** the list in §5.2.D.
  - **Unpaid invoices:** reuses the invoice ageing data.
  - **Recent payments:** last 30 days, all three sources.
- **Filters:** source, ageing bucket, overdue, partially paid, search (name, phone, room, invoice number).
- **Pagination:** server-side.
- **Account drawer:** statement (opening balance, charges, payments, closing balance) with links to each source row; "Receive payment".

### 6.2 Customer-account matching

- **Never merge accounts by phone.** Residents (`residents.phone` UNIQUE) and tiffin customers (phone indexed, uniqueness enforced only in order creation) stay separate accounts even if they share a number.
- Today `getCustomerOrderHistory` matches orders by phone. For receivables, match strictly by `orders.customer_id`. Every app-created delivery order has one, because order creation selects or creates the customer.
- Legacy orders without a customer id are listed under "Unlinked orders" for a manager to link by hand, never automatically.

### 6.3 Where each piece lives (no duplication)

| Place | Shows | Owns |
|---|---|---|
| Finance → Receivables (new) | Everything owed, ageing, statements, "Receive payment" | Nothing new; reads the three sources |
| Finance → Resident dues (existing) | Unchanged | Rent ledger |
| Tiffin → Billing (existing) | Invoice generation; link "See receivables" | Tiffin invoices |
| Tiffin → Customers (existing) | Pay Later toggle; balance badge | Customer eligibility |
| Delivery board / Orders (existing) | "Unpaid" and "Pay Later" chips and filters, per day | Delivery and collection |
| Reports → Outstanding balances (existing) | Add the order component | — |

### 6.4 One "Receive payment" for a tiffin customer

**Today** there are two disconnected ways to pay:
- a tiffin payment (Owner only) settles invoices;
- an order collection settles orders.

A payment recorded through the wrong one leaves the other item unpaid and creates hidden credit.

**Proposal:** one dialog on the account:
- **Amount, method, date and reference.**
- **Split:** the amount is spread across open items oldest first, shown before saving and adjustable.
- **One transaction** with one idempotency key:
  - creates order collections (custody of the person recording, as today) and/or a tiffin payment plus allocations;
  - refuses any amount above the total owed, unless you decide to allow advance credit (D8).
- Manager access needs a permission decision (D6), because tiffin payments are Owner-only today.

---

## 7. Invoice lifecycle and management

### 7.1 Current lifecycle (from source)

**Draft → Issued → Partially paid → Paid**, or **Cancelled**:

- **Numbering:** gapless per calendar year through `invoice_counters`, assigned at issue only.
- **Issue:** links an unlinked charge for the same period or posts one.
- **Cancel:**
  - refused if anything is allocated;
  - **tiffin:** unlinks the tasks so they can be billed again and flips the charge to `REVERSED` **in place**;
  - **resident:** only unlinks the rent charge.
- **Print:** `PrintableInvoiceModal`.
- **Ageing:** invoice ageing report.

### 7.2 Gaps and proposals

| Item | Today | Proposal | Migration |
|---|---|---|---|
| Duplicate invoice creation (same-instant identical requests) | 2 invoices; issued → 2 charges (verified) | `invoices.idempotency_key` UNIQUE + stable key per opened form (same pattern as the money forms) + `acquireLedgerKeyLock` on it | **Yes (0020)** |
| Repeat tiffin billing for a period | Safe (period lock + check) | Add the DB guarantee: partial UNIQUE index on `(customer_id, subscription_id, billing_period) WHERE status <> 'CANCELLED' AND invoice_category = 'TIFFIN'`. **First run a read-only duplicate check on production data.** If duplicates exist, they need your decision before the index can be built. | **Yes (0020)** |
| One resident invoice per resident per period? | Not enforced | Only if you confirm the rule (D10); otherwise idempotency only | Optional |
| Period text | Free text | P0 fix: issue matches by month (§4.2). Later: an optional `period_month` (YYYY-MM) column for reliable grouping. | Optional (P2) |
| Overdue | `OVERDUE` referenced but cannot be stored | Derived: `balance_due > 0 AND due_date < today` (no stored status, so it's never stale) | No |
| Cancellation history | Tiffin charge flipped to REVERSED in place, no dated counter-row | Post a dated `REVERSAL` row like every other reversal, so receivable history shows when it was cancelled | No |
| Allocation concurrency | Unlocked (P0 #2) | Lock the invoice and payment rows `FOR UPDATE` and recompute inside the transaction | No |
| Allocation history on payment reversal | Rows deleted (P0 #6 / P2) | P2: `invoice_payment_allocations.reversed_at` and `reversed_by` instead of delete | Yes (P2) |
| Credit notes | None | Not proposed (reversal + re-issue covers it) | — |
| PDF / print / export | Print view exists; CSV export on reports | Add the breakdown (§3.4) to the print view; browser "Save as PDF" (no server PDF library, so no performance cost) | No |
| Delivery orders | No invoice; balance on the order | **Recommend:** no individual invoices. They appear on the monthly **customer statement**. Rolling them into a tiffin invoice would require moving the receivable from the order to the ledger and is not proposed (D7). | No |

### 7.3 Statement vs invoice

An invoice is the charge for its period. The statement is the account view: opening balance + invoices and unpaid orders in the period − payments = closing balance.

Putting "previous balance" on each invoice invites double payment ("invoice total" vs "amount payable") and double counting in reports. Recommendation: **invoices carry period charges only; the statement carries the carry-forward.** Nothing needs to be stored: the statement is computed from the ledger and the orders at any date.

---

## 8. Database and API proposal

All changes are **additive**. Nothing is renamed or dropped and no CHECK constraint is narrowed. Every migration must be checked first against a copy of production data in a throwaway database. No migration was written or run for this analysis.

### 8.1 Migration 0020 — invoice idempotency (P0)

```sql
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_idempotency ON invoices (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Only after the read-only duplicate check returns no rows:
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_tiffin_period
  ON invoices (customer_id, subscription_id, billing_period)
  WHERE status <> 'CANCELLED' AND invoice_category = 'TIFFIN';
```

| Aspect | Detail |
|---|---|
| Existing rows affected | None. Old rows keep a NULL key. |
| Backfill | None |
| Risks | The partial unique index fails to build if duplicates already exist, hence the pre-check |
| Rollback | `DROP INDEX`; the column can stay (unused) |
| API impact | `POST /api/finance/invoices` accepts `idempotencyKey`; a replay returns the original invoice; reuse with a different payload is refused (same rule as the ledger) |

### 8.2 Migration 0021 — Pay Later fields (P1)

```sql
ALTER TABLE tiffin_customers ADD COLUMN IF NOT EXISTS pay_later_enabled integer NOT NULL DEFAULT 0;
ALTER TABLE tiffin_customers ADD COLUMN IF NOT EXISTS pay_later_updated_by text REFERENCES staff_users(id) ON DELETE SET NULL;
ALTER TABLE tiffin_customers ADD COLUMN IF NOT EXISTS pay_later_updated_at text;
-- only if you decide on a limit (D2):
-- ALTER TABLE tiffin_customers ADD COLUMN IF NOT EXISTS pay_later_limit integer CHECK (pay_later_limit IS NULL OR pay_later_limit >= 0);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_choice text
  CHECK (payment_choice IS NULL OR payment_choice IN ('CASH', 'UPI', 'PAY_LATER'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'NOT_DUE'
  CHECK (payment_status IN ('NOT_DUE', 'UNPAID', 'PARTIALLY_PAID', 'PAID'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_due integer CHECK (amount_due IS NULL OR amount_due >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount_collected integer NOT NULL DEFAULT 0 CHECK (amount_collected >= 0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pay_later_unapproved integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD CONSTRAINT chk_orders_collected_le_due CHECK (amount_due IS NULL OR amount_collected <= amount_due);
CREATE INDEX IF NOT EXISTS idx_orders_receivable ON orders (customer_id, service_date)
  WHERE payment_status IN ('UNPAID', 'PARTIALLY_PAID');
```

| Aspect | Detail |
|---|---|
| Existing rows | Defaults make every old order `NOT_DUE` with `amount_collected = 0` until the backfill runs |
| Backfill | Idempotent application script, run once after deploy (dry-run mode prints the counts first): for delivered orders set `amount_due`, `amount_collected` (Σ `delivery_collections`) and `payment_status`. Dine-in orders are paid at the table: `PAID`. |
| Delivery-order compatibility | `collected_amount` on the task stays authoritative for custody. The order fields are maintained in the same transactions (`completeLinedDelivery`, `collectOrderBalance`). |
| Offline compatibility | §5.2.F; legacy payloads handled |
| Risks | A backfill mismatch between order lines and collections for legacy data. The dry run lists any order where Σ collections > amount due, and those are left `NOT_DUE` for manual review. |
| Rollback | Drop the index and constraint; the columns can stay. The application must be rolled back first. |

### 8.3 P2 (optional, later)

- `invoice_payment_allocations.reversed_at`, `reversed_by` (keep history on payment reversal).
- `delivery_collections.status` or correction rows (manager corrections).
- `invoices.period_month`.
- `orders.order_no` with a yearly counter (only if D11 = sequential).

### 8.4 API changes

| Endpoint | Change | Permission |
|---|---|---|
| `POST /api/delivery/tasks/[id]/deliver` | Accept `paymentChoice`; validate it against the amounts; eligibility rule (§5.2.B) | `delivery.update` (unchanged) |
| `POST /api/delivery/sync` | Pass `paymentChoice` through | unchanged |
| `GET /api/delivery/tasks` | Add `payLaterAllowed` per doorstep task (boolean only) | unchanged |
| `POST /api/delivery/tasks/[id]/collect` | Maintain the order payment fields; stable key from the client | unchanged |
| `PATCH /api/tiffin/customers/[id]` | Accept `payLaterEnabled` (Owner, Manager) and `payLaterLimit` (Owner) | `tiffin.manage`, with an extra Owner check for the limit |
| `GET /api/finance/receivables` (new) | Totals, by-account page, unpaid orders page, ageing; server-side aggregation and pagination | `finance.read` |
| `GET /api/finance/receivables/[account]/statement` (new) | Statement for a date range | `finance.read` |
| `POST /api/finance/receivables/[account]/payments` (new) | Receive payment with split (§6.4) | D6 |
| `POST /api/finance/invoices` | `idempotencyKey` | unchanged |

---

## 9. Accounting decisions

### 9.1 Rules applied in this proposal

They follow your 14 rules and the existing definitions:

- Charges are recorded once. Rent: idempotent per stay and month. Tiffin: one invoice per subscription period, plus task stamping. Orders: state on the order.
- Payments are recorded once (idempotency keys + locks; P0 #5 closes the last per-click key).
- Payments never exceed what is owed. Rent: already. Order collections: already. Tiffin: **currently uncapped** (D8).
- Cash, UPI and Pay Later stay distinguishable: `payment_choice` on the order; custody rows only for money received.
- Delivery completion never implies settlement (`payment_status` is separate).
- Reversals keep history (P0 #6, and the cancellation fix in §7.2).

### 9.2 Cross-month Cashbook floor (no change; your decision D9)

When a month's refunds and reversals exceed its receipts, the Cashbook shows **₹0** for that month instead of a negative amount. Verified examples from the previous audit: April shows ₹0 for an actual −₹6,000 movement; June shows ₹0 for −₹4,000.

| Option | Monthly view | Multi-month totals | Revenue | Cash movement | Receivables | Refund history |
|---|---|---|---|---|---|---|
| **A. Keep the ₹0 floor** (current) | Never negative | **Do not add up** (Mar ₹6,000 + Apr ₹0 ≠ Mar–Apr ₹0) | Overstated in the refund month by the hidden amount | The daily closings are right; the monthly Cashbook disagrees with their sum | Unaffected (ledger balances are exact) | Kept in the ledger, invisible in the monthly figure |
| **B. Allow negative months** | Can be negative ("−₹6,000") | **Add up exactly** | Exact net per month | Matches the daily closings | Unaffected | Visible as a negative month, but mixed into "collected" |
| **C. Show refunds separately** | "Collected ₹X · Refunded ₹Y · Net ₹Z"; net can be negative | **Add up exactly** (net) | Gross receipts and refunds both visible | Net matches the daily closings | Unaffected | **Explicit line** |

**Recommendation: C.** It keeps every number true, reconciles with the daily closings and multi-month totals, and avoids a bare negative "collected" figure. It is a display change in the Cashbook and the dashboard only; no ledger or migration change.

---

## 10. Delivery offline and synchronisation implications

| Concern | Effect of the proposal | Guarantee kept by |
|---|---|---|
| Offline completion with Pay Later | Queued with `paymentChoice`; applied on sync | Same per-stop idempotency key; status guard |
| Synced twice | Second apply is a no-op | `status NOT IN ('DELIVERED', …)` guard; order fields are set by the same guarded statement, so no second write |
| Duplicate receivables | Impossible by construction (state on the order, not a new row) | — |
| Choice survives retries | Stored in the queued payload | Sanitiser must accept `PAY_LATER` (required change) |
| Eligibility changed while offline | Delivery accepted, flagged `pay_later_unapproved`, manager notified | Server decides at apply time |
| Old payload without a choice | Treated as legacy (§5.2.F) | — |
| Cash and UPI | Unchanged code paths | Existing tests plus new ones (§15) |
| Performance | One more boolean per task in the list; one extra column write at completion | Indexed by primary key; no extra round trip |

---

## 11. Page-by-page UI and data-layout audit

### 11.1 Method (verified)

1. **Long-data records were added** to the throwaway `rn_erp_verify_e2e_test` database through the app's own API, so every validation rule applied:
   - a room numbered `B1207-NORTH-ANX-xxxx` (20 characters, the maximum allowed);
   - a resident named "Venkata Subrahmanya Lakshminarayana Chakravarthy Ramaswamy Iyengar", with an 80-character email, ₹12,50,000 monthly rent and a ₹12,50,000 rent charge;
   - a partial payment with a 40-character bank reference;
   - two expenses of ₹9,87,65,432 with a 90-character payee and a 150-character description;
   - a tiffin customer with a 60-character name and a 150-character address.

   Negative figures came from the data itself (expenses > receipts).
2. **16 pages were checked at 6 widths** (360, 390, 768, 1024, 1280, 1440) = 96 checks. The probe flags three things:
   - page-level horizontal overflow;
   - text that leaves its card, cell, list item or dialog;
   - text silently clipped (overflow hidden without an ellipsis).

   Screenshots were taken of every flagged case and of every page at 360 and 1440.

**Result: 86 clean, 10 flagged.** Six of the 10 flags are the Dashboard's dark "Collected this month" card at every width. That is a **false positive**: the card clips its decorative circle by design, and the text is fully visible (checked in the screenshots). That leaves **seven real issues**, in five components.

**Not covered in this run:**
- The delivery staff app's payment screens with long data. They need a driver session; at phone widths with normal data they passed in the workflow suite (125/125).
- Dialogs with long forms (not opened by the probe).

Both are in the test plan for P3.

### 11.2 Real issues

| # | Page / width | What happens (screenshot-confirmed) | Component | Root cause |
|---|---|---|---|---|
| L1 | Dashboard 360, 390 | Spending card: the legend amount "₹19,75,30,864" runs past the card edge (44 px at 360, 14 px at 390), and at 360 the whole page scrolls sideways by 7 px. The donut's centre total touches the ring. | `app/(management)/dashboard/DashboardCharts.tsx` (spending legend and donut label) | Legend row is `flex` without `min-w-0` / wrapping; centre label has a fixed font size regardless of amount length |
| L2 | Finance → Cashbook 360 | Summary cards: "₹19,75,30,864" runs into the cell divider; "Net cash movement" puts the minus sign on its own line and cuts "₹19,70,84,204" at the card edge (all cells clip by 10 px) | `FinancialSummaryCards.tsx` → shared `StatStrip` (`components/ui/kit.tsx`, also used on the Delivery board) | Two-column stat grid with a fixed large font and no shrink rule for long amounts; sign and amount are separate inline pieces that can wrap apart |
| L3 | Finance → Cashbook 1280 | Transactions table is 126 px wider than the page: amounts are cut at the card edge ("−₹9,87,65,4…") and the **Actions column (Receipt / Reverse) is off-screen**; the page scrolls sideways | `CashbookLedger.tsx` table | `table` with `min-w-[760px]` and auto column widths; long payee and description texts widen their columns; the card does not scroll horizontally, so the page does |
| L4 | Residents 1024 | The long resident name button is drawn over the next column (49 px) | `app/(management)/residents/page.tsx` table | Name cell has no width limit or truncation |
| L5 | Finance → Resident dues 1024 | The long name overlaps the "Current room" text; "Not assigned" overlaps the raw resident id (`res_…`), which is shown to users | `ResidentStatementsView.tsx` | Same as L4, plus internal ids printed as secondary text |
| L6 | Dashboard (all widths) and Cashbook | Negative amounts are written two ways: "₹−19,70,93,204" (dashboard card) and "– ₹19,70,84,204" (Cashbook) | `lib/format.ts` callers | No single signed-money formatter |
| L7 | Cashbook (earlier report) | "Expected cash in hand" negative shows as `₹-12,18,220` | `DailyClosingView.tsx` | Same as L6 |

**Checked and clean with the same long data:**
- Rooms, Orders, Delivery board, Tiffin (customers, billing), Invoices, Daily closing, Reports, Activity, Staff, Settings, Notifications, at all six widths;
- Residents and Resident dues at 360, 390, 768, 1280, 1440 (their card layouts below 1024 handle the long name);
- the earlier normal-data audit: 48/48 at 360–1024 after the tooltip fix.

### 11.3 Reusable fixes (no page-specific hacks)

1. **`<Money value signed />`** in `components/ui`. One formatter for positive, negative and zero (`−₹19,70,84,204`, sign and amount kept together with `whitespace-nowrap`), `tabular-nums`, and an optional `fit` mode that steps the font size down for long amounts (CSS `clamp()` on the container width, no JavaScript). Used by summary cards, KPI tiles, chart labels and tables. Fixes L1 (centre label), L2, L6 and L7.
2. **Stat grid rule (in the shared `StatStrip`, so every page using it is fixed at once):** cells get `min-w-0`; below 400 px a cell with a long amount spans both columns (`grid-auto-flow: dense` plus a span class set by `<Money fit>`). Cards keep their natural height; no equal-height forcing.
3. **`<CellText>`** for table name and description cells: `truncate` with the full text in `title` and an accessible label; emails `break-all` inside their cell. Applied to the Residents, Resident dues and Cashbook tables. Fixes L4 and L5.
4. **Wide tables:** `table-fixed` with explicit widths for date, type, amount and actions; description and party truncate (via `CellText`). The table wrapper becomes `overflow-x-auto` as a last resort, so the page itself never scrolls and the Actions column stays reachable. Fixes L3.
5. **Chart legends:** legend items `min-w-0` with the amount below the label on narrow widths. Fixes L1.
6. **Remove raw ids from user-facing text** (`res_…` in Resident dues); keep them in a copy button where they are needed.
7. **Regression test:** keep `layout_longdata.js` (scratchpad today) as a repeatable check. In P3, move the long-data fixture and probe into the repository's test tooling so they can run against any throwaway database.

---

## 12. Complete control inventory

### 12.1 Reconciliation with the 251-control inventory of 4 Nov

The full per-control table (page, control, how tested, result) is in `PERFORMANCE_AUDIT_2026-11.md` §10:

| Page | Controls |
|---|---:|
| Dashboard | 19 |
| Orders | 13 |
| Delivery (manager) | 23 |
| Residents | 13 |
| Tiffin | 22 |
| Rooms | 14 |
| Cashbook | 22 |
| Resident dues | 14 |
| Invoices | 17 |
| Daily closing | 19 |
| Reports | 19 |
| Activity | 8 |
| Staff | 17 |
| Settings | 18 |
| Notifications | 7 |
| Account | 6 |
| **Total** | **251** |

All 251 had a result:
- 244 passed;
- 4 passed after a fix in that round;
- 3 not applicable (disabled by design in that state).

Since then, only four application files changed, none adding or removing a control: the tiffin billing lock, the tiffin payment key, Cashbook memoisation and the dashboard tooltip. **The 251 are current for the manager ERP.**

**Not in the 251:**
- the **delivery staff app** (driver side);
- states only reachable with specific data (e.g., "Collect balance" appears only when a balance exists; it was covered by the workflow suite instead).

Both are covered below.

### 12.2 Financial and destructive controls, with backend effect

| Page | Section | Control | Purpose / actual behaviour | API / function | Data impact | Roles | Status | Recommendation |
|---|---|---|---|---|---|---|---|---|
| /finance?tab=cashbook | Actions | Record payment | Rent payment, capped at outstanding; stable key + in-flight guard | `POST /api/finance/transactions` → `recordRentPayment` | create ledger row + audit | Owner, Manager | Working (verified 5 concurrent → 1) | Keep |
| /finance?tab=cashbook | Actions | Expense | Expense; stable key | same → `recordExpense` | create | Owner, Manager | Working (verified) | Keep |
| /finance?tab=cashbook | Actions | Security deposit | Deposit; stable key | same → `recordSecurityDeposit` | create | Owner, Manager | Working (verified) | Keep |
| /finance?tab=cashbook | Actions | Rent charge | Manual charge; stable key | same → `recordRentCharge` | create | Owner, Manager | Working (verified) | Keep; P0 #3 guards the invoice path |
| /finance?tab=cashbook | Actions | Monthly rent | Preview, then charge prorated rent | `GET/POST /api/finance/rent-run` | create (idempotent per stay+month) | Owner, Manager | Working (verified 125/125) | Keep |
| /finance?tab=cashbook | Row menu | Reverse | Dated reversal; refuses double reversal | `POST /api/finance/transactions` with `action: "REVERSAL"` → `reverseTransaction` | create REVERSAL, flip status, **delete allocations** | Owner | Working; **gap P0 #4, #6** | Fix: block delivery-collection rows; keep allocation history (P2) |
| /finance?tab=cashbook | Row | Receipt | View or print receipt | read | read | Owner, Manager | Working | Keep |
| /finance?tab=invoices | Header | New invoice | Draft invoice | `POST /api/finance/invoices` → `createInvoice` | create | Owner | **Duplicate on same-instant requests** (verified) | Fix: 0020 + stable key |
| /finance?tab=invoices | Row | Issue | Number + charge link/post | `POST …/[id]/issue` | update + maybe create charge | Owner | **Double rent charge if period text differs** (P0 #3) | Fix |
| /finance?tab=invoices | Row | Allocate payment | Allocate an unallocated payment | `POST …/[id]/allocate` | create allocation, update invoice | Owner | **Unlocked** (P0 #2) | Fix |
| /finance?tab=invoices | Row | Cancel | Cancel with reason; refused if allocated | `POST …/[id]/cancel` | update; tiffin: flip charge, unlink tasks | Owner | Working; history gap (§7.2) | Improve |
| /finance?tab=invoices | Row | Print | Printable invoice | read | read | Owner, Manager | Working | Improve (breakdown) |
| /finance?tab=closing | Day | Save draft / Finalize / Reopen | Daily closing | `POST /api/finance/closing`, `…/[id]/reopen` | create/update; locks the day | Owner | Working (verified) | Keep |
| /tiffin?tab=billing | Header | Generate invoices | Monthly tiffin invoices | `POST /api/tiffin/billing/generate` | create invoices, charges; stamp tasks | Owner | Working (race fixed) | Keep; add 0020 index |
| /tiffin?tab=billing | Customer | Record payment | Tiffin payment (+ allocation) | `POST /api/tiffin/payments` | create | Owner | Working (verified 5 → 1) | Keep; merge into "Receive payment" (§6.4) |
| /tiffin?tab=billing | Customer | Balance | Balance modal | `GET /api/tiffin/customers/[id]/balance` | read | Owner, Manager | **Unallocated figure wrong** (P0 #1, verified) | Fix |
| /tiffin | Customers | New / Edit / Status | Customer record | `POST/PATCH /api/tiffin/customers…` | create/update | Owner, Manager | Working (verified) | Add Pay Later toggle (P1) |
| /tiffin?tab=subscriptions | Row | New / Pause / Resume / Cancel | Subscription lifecycle | `/api/tiffin/subscriptions…` | create/update | Owner, Manager | Working (verified) | Keep |
| /residents | Row | Check-in / Check-out / Transfer / Settlement approve-reject | Stay lifecycle and money settlement | `/api/residents/check-in`, `check-out`, `transfer`, `settlement-proposals` | create/update ledger | Owner; Manager proposes deposit moves | Working (verified) | Keep |
| /rooms | Room | Add / Edit / Delete / Beds / Maintenance | Inventory | `/api/rooms…` | create/update/delete | Owner, Manager | Working (verified) | Keep |
| /orders | Header / Row | New order / Edit / Cancel | Order lifecycle | `POST /api/orders`, `…/revisions`, `…/cancel` | create/update | Owner, Manager | Working (verified; idempotent) | Add payment-status chip (P1) |
| /delivery | Task panel | Assign / Retry / Cancel / Resolve | Delivery lifecycle | `/api/delivery/tasks/[id]/…` | update + event | Owner, Manager | Working (verified) | Keep |
| /delivery | Task panel | **Collect balance** | Record a later payment (amount, Cash/UPI) | `POST …/[id]/collect` → `collectOrderBalance` | create collection (+ UPI ledger row) | Owner, Manager | Working; **per-click key** (P0 #5) | Fix (stable key + ref guard) |
| /delivery?tab=custody | Handover | Accept handover | Accept declared cash/UPI | `POST /api/delivery/handover/[id]/accept` | create ledger row, update handover | Owner, Manager | Working (verified) | Keep |
| /staff | Row | Create / Role / Status / Reset password | Staff admin | `/api/staff…` | create/update | Owner | Working (verified) | Keep |
| /settings | Form | Save | Business settings (rent due day, default driver…) | `/api/settings` | update | Owner | Working (verified) | Keep |

### 12.3 Delivery staff app: payment-related controls (current, from source)

| Screen | Control | Purpose / behaviour | API | Data impact | Roles | Status | Recommendation |
|---|---|---|---|---|---|---|---|
| Stops | Filter "Collect Cash/UPI" | Lists doorstep stops still open or with a balance | read | read | Driver | **Unclear**: no action to collect later | Add "Collect balance" (D6) or rename |
| Stop card | Start | Mark out for delivery | `…/dispatch` | update + event | Driver (own) | Working (verified) | Keep |
| Stop card / sheet | Deliver | Open the delivery form | — | — | Driver | Working (verified) | Keep |
| Delivery form | Delivered-quantity steppers, reason chips, "where it went" (3), "Handed over to" menu | Per-line outcome | — | — | Driver | Working (verified) | Keep |
| Delivery form | Amount collected (₹) | Pre-filled with the amount due; 0…due | `…/deliver` | create collection if > 0 | Driver | Working; **₹0 = implicit pay later** | Replace with the three-way choice (P1) |
| Delivery form | Cash / UPI toggle | Method | `…/deliver` | Cash → custody; UPI → ledger | Driver | Working (verified) | Keep; add Pay Later |
| Delivery form | Confirm / "Not delivered" | Complete or exception; queued offline | `…/deliver`, `/api/delivery/sync` | update + event + audit | Driver | Working (verified, idempotent) | Keep |
| Cash tab | Hand over cash / Confirm / Back | Declare custody | `/api/delivery/handover/declare` | create handover | Driver | Working (verified) | Keep (Pay Later never adds to it) |
| Offline banner | Try again | Re-sync queued actions | `/api/delivery/sync` | as queued | Driver | Working (verified) | Keep |

### 12.4 Proposed new controls

| Where | Control | Roles |
|---|---|---|
| Driver form | Cash / UPI / **Pay Later** choice | Driver; Pay Later only if eligible |
| Driver form | Confirm button "Mark as delivered, pay later" | Driver |
| Tiffin → Customers form | "Allow Pay Later" toggle | Owner, Manager |
| Tiffin → Customers form | Limit (only if D2) | Owner |
| Finance → Receivables | Tabs, filters, search, pagination, export CSV, account drawer, "Receive payment" (split preview, Confirm) | Owner, Manager per D6 |
| Delivery board, Orders | Chips "Pay Later", "Unpaid", "Unapproved" | Owner, Manager |

---

## 13. Loading experience redesign

### 13.1 What happens now (from source)

1. A click shows the destination frame (`NavSkeleton`) at once: title, breadcrumb and one of three generic shapes. Dashboard = 4 tiles; Settings and Account = 2 cards; everything else = summary strip + list.
2. The page renders. Pages that fetch on the client then show **their own centred loader** until data arrives: Residents, Rooms, Orders, Notifications, Activity, Reports, Cashbook, the Delivery board and custody (`BikeLoader` / `FullPageLoader`). That is the "skeleton → spinner → content" sequence you saw.
3. In green sections the loader is the **house built brick by brick** (`HouseGraphic`, swapped in by CSS for `.rn-bike` inside green sections). Its loop lays four courses of bricks, then the roof and door, on a **2.6 s cycle** (`styles/glass.css`, `rn-brick` / `rn-roof`). Short loads see half a house.
4. `/delivery` and `/account` keep a `loading.tsx` (`FullPageLoader`) because the driver app uses them.

### 13.2 Proposal

**Navigation:**
- Give each page a **destination-matched skeleton component** that the shell's `NavSkeleton` and the page's own first-load state both use. The page keeps the same skeleton until its data arrives, with **no second loader**.
- Replace the in-page `BikeLoader` first-load blocks (the list in 13.1) with the page's skeleton.
- Busy buttons keep the inline loader.

**Dashboard skeleton matching the real layout (`DashboardView.tsx`):**
- greeting/header row;
- the dark-green "collected this month" hero card;
- KPI tiles;
- collections chart card (same height as the chart);
- monthly revenue card;
- "Recent transactions" list (5 rows);
- "Needs attention" list.

Dimensions are taken from the real classes (`rounded-[28px] p-6`, chart heights), so the content replaces it without layout shift. No fake numbers.

**House loader (blocking states only: first app bootstrap, sign-in hand-off):**
- One inline SVG: a single-stroke architectural house outline in forest green (`#263B2D`), roof ridge and door drawn as one path, with a muted brass (`#B58A57`) line that lights the roof once per cycle.
- Animation: `stroke-dashoffset` draw-in (~600 ms) then a 1.2 s soft roof glow, in CSS only, no library.
- `prefers-reduced-motion`: a static outline.
- Centred with the existing `useFillHeight` (the visible area between the header and any bottom bar), so it sits in the middle on phones and desktops. The off-centre cases come from loaders placed with `py-12` inside page flow instead of the fill container.
- **Never shown over a skeleton.**

**Brick house:** removed (CSS swap and `HouseGraphic`).

**Scooter:** stays for the delivery app and orange sections (busy buttons, sync).

**Fast transitions:** keep the shell's existing behaviour (the destination frame only while not arrived). For cached returns under ~100 ms the frame is replaced in the same frame, so there is no flash. If any flash shows in testing, delay skeleton visibility by 80 ms with CSS `animation-delay`, never JavaScript timers.

| Item | Files | Risk | Tests |
|---|---|---|---|
| Matched skeletons | `components/layout/shell/NavSkeleton.tsx` → per-page skeleton components; pages listed in 13.1 | Low (UI only) | Navigation stress 20/20; per-frame check "previous page and destination never together"; layout-shift measurement |
| Dashboard skeleton | new `DashboardSkeleton` used by the shell | Low | Screenshot comparison at 6 widths |
| House loader | `components/feedback/BikeLoader.tsx` (`HouseGraphic`), `styles/glass.css` | Low | Reduced-motion check; centring at 360–1440 |

---

## 14. Performance impact assessment

Baseline to preserve (previous audit, production build):
- first visits median ~222 ms; return visits ~125 ms;
- destination frame 6–164 ms;
- navigation stress 20/20;
- Cashbook search ~40% faster.

| Change | Expected cost | How it stays fast | Must re-measure |
|---|---|---|---|
| P0 fixes | One subquery instead of a join; row locks on allocation (milliseconds, rare action) | Indexed by primary key | Duplicate-audit suite |
| Order payment fields | One extra UPDATE inside existing completion and collection transactions | Same transaction; no extra round trip | Delivery completion latency (driver form), offline replay |
| `payLaterAllowed` on the task list | Joined from `tiffin_customers` by primary key in the existing task query | No N+1: one join in the list query | `/api/delivery/tasks` payload size and time |
| Receivables page | Three aggregate queries plus one paginated list | Server-side `GROUP BY` on indexed columns; partial index `idx_orders_receivable` keeps the unpaid-order scan small even with years of orders; ledger aggregates use the existing `idx_fin_tx_resident` / `idx_fin_tx_customer`; **no full ledger load to show a balance**; pagination 50 | First visit and return visit like other pages; query plans at the large-dataset volume (5,000+ ledger rows, 20,000 audit rows) |
| Statements | One account's rows for one period | Index by account + date; paginated | Statement load time |
| Skeleton changes | Fewer elements than today's loader swap | No timers; CSS only | Navigation benchmark and stress |
| House loader | One small SVG; CSS animation on transform/opacity/stroke only | No layout animation | Reduced-motion check |
| Live updates | Receivables subscribes to the existing change signals (ledger, orders) | **No polling** | — |

---

## 15. Implementation roadmap

Dependencies decide the order. P3 (loading and layout) has no dependency on the money work and can run alongside it after P0.

| Step | Priority | Content | Migration | Depends on | Tests required |
|---|---|---|---|---|---|
| 1 | **P0** | Six fixes, all without a migration: (1) unallocated sum, (2) allocation locks, (3) resident invoice issue never double-charges a month, (4) block generic reversal of delivery-collection rows, (5) manager "Collect balance" stable key + in-flight guard, (6) remove the dead `OVERDUE` branch | No | — | New unit/integration tests for each; duplicate-audit suite; full `test:safe`; workflow suite |
| 2 | **P0** | Invoice idempotency + tiffin period unique index | **0020** (after a read-only duplicate check on production data, with your approval) | 1 | Concurrency tests (5 identical requests → 1 invoice); migration on a copy of production data in a throwaway DB |
| 3 | **P1** | Pay Later fields + backfill script (dry run first) + server: completion/collect maintain order payment fields, eligibility rule, audit fields, notifications | **0021** | 2 | Server tests: Cash / UPI / Pay Later / short collection / not eligible / offline replay twice / legacy payload / revoked eligibility; custody totals unchanged; UPI never in cash |
| 4 | **P1** | Driver form three-way choice + sanitiser + manager toggle on customers + board/Orders chips | No | 3 (same release; the Android shell loads the site, so they ship together) | Driver E2E on phone widths (360/390); offline E2E (airplane mode, sync twice); tap-target size |
| 5 | **P2** | Receivables page (read-only first), statement drawer, Outstanding report includes orders | No | 3 | Reconciliation test: Σ receivables = Σ rent ledger balance + Σ tiffin ledger balance + Σ order balances; performance at large volume |
| 6 | **P2** | "Receive payment" with split; Manager permission per D6; invoice print breakdown; dated reversal row on invoice cancel | No (unless D6 needs a new permission name; code-only) | 5 | Split/idempotency/over-payment tests; allocation history |
| 7 | **P2** | Allocation history on reversal; collection corrections; optional `period_month`, `order_no` | Optional | 6 | — |
| 8 | **P3** | Loading: matched skeletons, dashboard skeleton, house loader, remove brick house; layout fixes from §11 | No | — (can start after 1) | Navigation benchmark + stress; layout audit at 6 widths with long data; reduced motion |
| 9 | **P4** | Further performance refinements (New order typing ~90 ms/keystroke at 4× throttle; Cashbook at 500 entries) | No | — | Before/after measurements |

---

## 16. Features to remove or avoid

| Item | Why |
|---|---|
| Brick-by-brick house loader | Slow; reads as "not finished"; replaced by §13 |
| In-page first-load spinners after the skeleton | Causes the double loading stage |
| `SingleScreenDeliveryModal.tsx` | Dead code (not imported); delivery code, so it is removed only with your approval |
| `OVERDUE` stored status | Cannot be stored; derive from the due date |
| Copying order receivables into the general ledger | Contradicts ADR-05; cannot be settled per customer with lump handovers; creates double counting |
| "Previous balance" printed on each invoice | Invites double payment and double counting; use statements |
| Merging accounts by phone number | Different people share numbers; residents and customers are separate accounts |
| Customer-facing payment gateway, UPI verification workflow, credit notes, write-offs | Not requested or decided; add only when a real case and a rule exist |
| Polling for balances | Change signals already exist |
| Server-side PDF generation | The browser print/PDF covers it with no server cost |

---

## 17. Decisions required from you

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Who may use Pay Later at the door | (a) every customer; (b) only customers a Manager or Owner approved | **(b)** |
| D2 | Credit limit | (a) none, show outstanding and age; (b) per-customer limit set by the Owner | **(a)** to start |
| D3 | A short Cash/UPI collection for a customer **not** approved for Pay Later | (a) allowed as today; (b) treated as Pay Later: blocked in the app, and if it reaches the server, accepted and flagged | **(b)** |
| D4 | Offline Pay Later synced after approval was withdrawn | (a) reject the delivery; (b) accept the delivery, flag it, notify managers | **(b)** (never lose a real delivery; never treat it as paid) |
| D5 | Who can approve Pay Later accounts | (a) Owner only; (b) Owner and Manager | **(b)** for the toggle; the limit (if any) Owner only |
| D6 | Who records later payments | Office: Owner only / Owner + Manager. Door: should drivers collect balances later in the app? | Owner + Manager at the office (Manager already can for orders; extend to tiffin via "Receive payment"); drivers: **yes**, only for their own stops, using the existing offline action |
| D7 | Monthly document for Pay Later orders | (a) customer statement; (b) roll them into a tiffin invoice | **(a)** |
| D8 | Payments above what is owed | (a) refuse everywhere (as rent does); (b) allow customer credit (as tiffin does today) | **(a)**, unified; existing tiffin credits stay visible as "unallocated" |
| D9 | Cashbook month with refunds > receipts | A keep ₹0 floor / B negative months / C refunds shown separately | **C** |
| D10 | Database rule "one rent invoice per resident per period" | yes / no | No (idempotency only), unless you never issue two invoices for one month |
| D11 | Order reference shown to managers | (a) short reference from the id; (b) sequential number (migration) | **(a)** first |
| D12 | Extra PG charge types (electricity, damage, laundry…) | none / list them | Your list; implemented as categories without a migration |
| D13 | Tiffin monthly package pause/proration | Open since the requirements (§16 #3) | Needed before monthly-package invoices can show a correct breakdown |
| D14 | Due date and "overdue" | e.g. invoice due date + 0 days; orders due after N days | Orders: overdue after 30 days; invoices: their due date |
| D15 | Approve migrations 0020 and 0021 (after the read-only duplicate check) | — | Required before steps 2–3 |
