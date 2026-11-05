# Financial system implementation, P0 verification through P2 — November 2026

Date: 2026-11-05. Status: **implemented and tested on disposable databases; not committed, pushed or deployed; no migration applied to Neon or to the local development database.** Waiting for review and a separate migration/release approval.

Related documents:
- `docs/ERP_FEATURE_AND_UI_ANALYSIS_2026-11.md` (analysis; decisions D1–D15)
- `docs/P0_FINANCIAL_INTEGRITY_FIXES_2026-11.md` (the six P0 fixes)

---

## A. Implementation summary

### Completed

| Area | What it does now |
|---|---|
| P0 verification | All six fixes present and passing. Extra checks added for cash, UPI, part payments, mixed methods, one reversal among several collections, and repeated reversal (§F). |
| Migration 0020 | Invoice idempotency key; canonical billing month; one active tiffin invoice per customer, subscription and month, enforced by the database. A read-only duplicate scan comes first, and the migration stops if duplicates exist. |
| Migration 0021 | Pay Later approval on the tiffin customer; the payment choice made at the door; a review flag on the order. Additive only. |
| Delivery payments | Driver chooses **Cash**, **UPI** or **Pay Later**. Part payments are allowed. Any remainder needs Pay Later approval. Overpayment is refused on the server. |
| Offline | Choice and approval snapshot survive the queue. A sync after approval was withdrawn is **accepted and flagged**, never rejected or converted. Duplicate syncs apply once. |
| Pay Later controls | Owner and Manager allow or stop Pay Later in the customer profile. The profile shows the delivery balance, its age and who changed it last. Audited with previous and new state. Drivers are refused by the server. |
| Finance → Receivables | One view over PG rent, tiffin invoices and delivered orders: source totals, ageing, filters, search and server-side paging. Account view, review closing, statement and **Receive payment**. |
| Statements | Built from the source records each time. Opening balance carried forward, running balance, reversals visible as their own entries. Tiffin invoices list their delivered days. |
| Receive payment | Per-item amounts chosen explicitly. Each part goes through its own source's service, all in one transaction. Idempotent; overpayment refused. |
| Cashbook | Refunds of earlier receipts appear on their own line; the net can be negative (decision D9). Negative amounts read `−₹1,234` across the ERP. |

### Deferred (not part of this release)

- **Global loading redesign (P3):** the house loader, the Dashboard skeleton and matched skeletons for the existing pages. The completion gate stops before P3. The new screens follow the agreed rule: destination skeleton immediately, no spinner after it.
- **Driver "collect a balance later" in the app.** The server already allows a driver to collect on their own assigned stops; no driver screen was added (it would change a non-payment driver workflow). Office collection is done in Receivables.
- **Cash handover correction and individual cash-collection reversal** (§I).
- **D10–D14** stay unresolved, and existing behaviour is kept in those areas (§I).

### Architectural decisions

1. **No second ledger.** Every balance is computed from the records that already own it:
   - rent ledger;
   - tiffin invoices and their allocations;
   - orders with their delivery collections.

   Order amount due, collected and payment status are derived, never stored. The only new order fields record facts that cannot be derived: the choice made at the door, and the review flag.
2. **Customer identity = `tiffin_customers` row**, matched by `orders.customer_id`. Every order created through the app is attached to one (the order form selects the customer or creates one by phone, refusing duplicates).
   - Residents are a separate identity; nothing is merged by phone.
   - Older orders without a customer record become their own account and cannot use Pay Later.
3. **Schema-optional code.** Every new column is read and written only after a cached check that its migration is installed (`server/database/schemaFeatures.ts`, the same pattern as `hasDeliveryOpsSchema`). The code can therefore be deployed before the migrations, and localhost on an unmigrated database keeps working. Proven by `pg_schema_compat_0019` (§F).
4. **Source-specific accounting for payments.** Receive payment calls:
   - `recordRentPayment` for PG;
   - `recordTiffinPayment` with the invoice it pays, for tiffin;
   - `recordDeliveryCollection` for orders.

   Each keeps its own caps, locks, custody and audit. There is no generic payment writer.

### Files

**New:**
- `apps/erp/src/server/database/drizzle/0020_invoice_idempotency.sql`
- `apps/erp/src/server/database/drizzle/0021_pay_later.sql`
- `apps/erp/src/server/database/schemaFeatures.ts`
- `apps/erp/src/server/finance/receivablesService.ts`
- `apps/erp/src/server/tiffin/payLaterService.ts`
- `apps/erp/src/app/api/finance/receivables/` (`route.ts`, `account/`, `statement/`, `payments/`)
- `apps/erp/src/app/api/tiffin/customers/[id]/pay-later/route.ts`
- `apps/erp/src/app/api/orders/[id]/payment-review/route.ts`
- `apps/erp/src/modules/finance/components/ReceivablesView.tsx`
- `apps/erp/src/modules/finance/components/ReceivePaymentDialog.tsx`
- `apps/erp/src/modules/tiffin/components/PayLaterPanel.tsx`
- `scripts/scan-invoice-duplicates.js`
- `tests/pg_migrations_0020_0021.test.ts`
- `tests/pg_payments_receivables.test.ts`
- `tests/pg_schema_compat_0019.test.ts`

**Changed** (lines added / removed against copies taken at the start of this phase; everything else in the files is preserved):

| File | + | − |
|---|---:|---:|
| `server/database/drizzle/meta/_journal.json` | 14 | 0 |
| `server/database/schema/index.ts` | 13 | 0 |
| `server/delivery/deliveryService.ts` | 86 | 6 |
| `server/finance/invoiceService.ts` | 53 | 5 |
| `server/finance/financeService.ts` | 21 | 0 |
| `server/tiffin/tiffinBillingService.ts` | 24 | 8 |
| `server/notifications/notificationService.ts` | 24 | 0 |
| `types/index.ts` | 28 | 0 |
| `app/api/delivery/tasks/[id]/deliver/route.ts` | 2 | 0 |
| `modules/delivery/offlineQueue.ts` | 8 | 0 |
| `modules/delivery/ops/DeliverySheet.tsx` (payment section only) | 72 | 21 |
| `app/(management)/finance/page.tsx` | 35 | 4 |
| `components/layout/shell/nav.ts` | 2 | 0 |
| `modules/finance/components/FinancialSummaryCards.tsx` | 23 | 5 |
| `modules/finance/components/modals/CreateInvoiceModal.tsx` | 4 | 0 |
| `modules/tiffin/components/modals/CustomerDetailModal.tsx` | 4 | 0 |
| `lib/format.ts` | 11 | 0 |
| `modules/finance/utils/formatUtils.ts` | 3 | 3 |
| `app/(management)/dashboard/{DashboardCharts,DashboardView,page}.tsx` | 7 | 6 |
| `modules/account/AccountPage.tsx` | 2 | 1 |

Line endings of every changed file are as they were (checked byte-level; 0 changed). New files use CRLF, the tree's majority.

---

## B. Migration 0020 — invoice idempotency

**Schema (additive):**
- `invoices.idempotency_key text`, with a partial unique index `idx_invoices_idempotency`.
- `invoices.billing_month text`, with CHECK `YYYY-MM`. It is filled for existing rows whose `billing_period` is a recognisable month (same rules as `canonicalBillingMonth`); other text stays NULL.
- Partial unique index `idx_invoices_tiffin_sub_month` on `(customer_id, subscription_id, billing_month)` WHERE `status <> 'CANCELLED' AND invoice_category = 'TIFFIN' AND subscription_id IS NOT NULL AND billing_month IS NOT NULL`.

**Uniqueness rule:** one active invoice per tiffin customer, subscription and month.
- Manual tiffin invoices (no subscription) are not constrained.
- Resident invoices are not constrained (D10 is unresolved; several resident invoices in one month are current behaviour).
- Period text that is not a month is not constrained.

**Duplicate audit:** `scripts/scan-invoice-duplicates.js <url>` is read-only (the session is set READ ONLY). It lists each group's invoice ids, subscription, periods, amounts, and whether the spelling or the amount differs.
- Before the unique index is built, the migration counts duplicates. If any exist it **raises an error and nothing is applied** (single transaction). The duplicates must be resolved by a person; nothing is merged or cancelled automatically.
- Scans run: `rn_erp_verify_test` (6 active subscription invoices), `rn_erp_verify_e2e_test` (0) and `rn_erp_verify_large_test` (1): **0 duplicates each**.
- **Production must be scanned (read-only) before approval.**

**Idempotency strategy:**
- The invoice form keeps one key per opened form.
- `createInvoice` takes an advisory lock on the key inside its transaction. A repeat with the same payload returns the first invoice; the same key with a different payload is refused. The unique index is the backstop.
- Two creations for one subscription and month that race past the checks: the unique index refuses one, with a clear message ("This subscription already has an active invoice for that month.").
- Monthly tiffin billing also treats an existing invoice for the same canonical month as billed ("Dec 2041" vs "2041-12").
- Issuing an invoice twice was already safe (P0: row lock and DRAFT re-check).

**Rehearsal (`pg_migrations_0020_0021`, 15/15):**
- **Fresh database:** all 22 migrations apply; 10 new columns and 5 indexes exist.
- **Upgrade from 0019 with a deliberate duplicate** (same subscription, "Nov 2026" ₹3,000 and "November 2026" ₹3,100):
  - the scan lists exactly that pair;
  - the migration stops with 20 migrations still applied and no new column;
  - after the duplicate was cancelled, 0020 and 0021 apply;
  - existing invoices keep id, amounts, status and period text;
  - `billing_month` is filled correctly (NULL for "Special catering week");
  - the database refuses a second active invoice for that subscription and month, but allows the next month;
  - one key cannot belong to two invoices;
  - existing customers start with Pay Later off;
  - re-running the migrations is a no-op.

**Rollback:** drop the two indexes; the columns can stay unused. The application tolerates either state (decision 3).

---

## C. Migration 0021 — Pay Later

**Customer identity:** `tiffin_customers` (see A.2). Investigation results:
- every delivery order created through the app has `customer_id`;
- a customer can exist without a subscription (order-only customers);
- order creation refuses a second customer with the same phone;
- residents are separate.

**Eligibility model:**
- `tiffin_customers.pay_later_enabled` (0/1, default 0), `pay_later_updated_by`, `pay_later_updated_at`.
- Set by Owner or Manager (`tiffin.manage`) through `PUT /api/tiffin/customers/[id]/pay-later`.
- Every change writes `tiffin.customer_pay_later_changed` with `{previous, next}`; an unchanged repeat writes nothing.
- No credit limit (D2).

**Order payment model:**

| Concept | Where |
|---|---|
| Delivery status | `delivery_tasks.status` (unchanged) |
| Order lifecycle | `orders.status` (unchanged) |
| Payment choice at the door | `orders.payment_choice`: CASH / UPI / PAY_LATER; NULL before delivery or for older orders |
| Amount payable | Σ delivered quantity × saved unit price (order lines) |
| Amount collected | Σ delivery collections that still count (`activeCollectionSql`: cash always counts; a UPI collection stops counting when its cashbook entry is reversed) |
| Outstanding / payment status | Payable − collected: UNPAID / PARTIALLY_PAID / PAID; derived |
| Remainder without approval | `orders.payment_review = 'PAY_LATER_NOT_APPROVED'`, with `payment_review_detail` (JSON evidence) and `payment_reviewed_by` / `_at` |

Nothing financial is duplicated, so there is nothing to reconcile.

**Indexes:**
- `idx_orders_payment_review` (partial, open reviews);
- `idx_orders_type_status_date`;
- `idx_dcol_order`.

**Backfill:** none needed. Old orders have `payment_choice` NULL; their balances are derived like all others (so an existing delivered-but-unpaid order shows in Receivables, as it already did as "UNPAID ₹x" on the Orders page).

**Offline behaviour:**
- **Queued payload:** the queue sanitiser now keeps `paymentChoice` and `payLaterAllowedAtSelection`, which it previously would have dropped.
- **Server side:** `syncDeliveryActions` passes them on, marked `viaOfflineSync`.
- **Recording:** the server decides with the approval **as it is at sync**:
  - approved → no flag;
  - not approved → the delivery is recorded, the choice kept, the order flagged.
- **Evidence recorded with the flag:** remainder, amounts, choice, `approvedOnDeviceWhenChosen`, `approvedAtSync: false`, `viaOfflineSync`, and who and when.
- **Notification:** managers get "Unpaid delivery to review", linking to Receivables with the review filter.
- **Repeats:** the per-stop key and the task status guard make repeated or simultaneous syncs a no-op.
- **Unpaid state:** never stored as a row, so it cannot be duplicated.

---

## D. Financial architecture

| Source | Authoritative records | How a payment is recorded | How a reversal affects the balance |
|---|---|---|---|
| PG rent | `financial_transactions`: RENT_CHARGE / RENT_PAYMENT (+ deposit application) | `recordRentPayment`: capped at the resident's balance, per-resident lock, idempotent | Reversal flips to REVERSED and adds a dated REVERSAL row; posted rows only are counted |
| Tiffin invoices | `invoices` (balance_due) + `invoice_payment_allocations` + TIFFIN_CHARGE / TIFFIN_PAYMENT | `recordTiffinPayment` with the invoice: payment and allocation in one transaction; allocation locked and capped at the invoice balance | Allocation rows are kept; an allocation stops counting with its payment (P0 #6); the invoice reopens |
| Delivery orders | `orders`, `order_items`, `delivery_collections` | Door: completion records a collection for money received (cash → custody of the collector; UPI → booked to the cashbook at once). Later: `recordDeliveryCollection`, capped at the balance under a task lock | Reversing a UPI collection's cashbook entry makes it stop counting (P0 #4); cash handover entries cannot be reversed from the Cashbook |

**Receivables aggregation (SQL, server-side):**
- **PG:** each charge minus settlements applied oldest first.
- **Tiffin:** each open invoice's `balance_due`, plus each unallocated payment as a **credit line**, so the account equals the tiffin ledger (charges − customer payments).
- **Delivery:** each delivered order's payable minus active collections.

Accounts are `R:<resident>`, `C:<customer>` or `O:<order without customer>`. Totals and ageing come from the same lines, and the tests check that PG + Tiffin + Delivery = total and that ageing buckets + unallocated credit = total.

**Ageing:** days since the amount became outstanding (charge date, invoice issue date, delivery date), in buckets 0–7, 8–30, 31–60 and over 60 days. No overdue rule is applied (D14 unresolved).

**Statements:** events from the same records, sorted by date.
- Charge, payment, reversal; a cancelled tiffin invoice's charge is reversed on the invoice's cancellation date.
- Opening = everything before `from`. Closing at today = the account's Receivables total (tested for every account type).

---

## E. UI implementation

**Driver payment** (`DeliverySheet`, orange, payment section only):
- **Choices:** three large choices, Cash / UPI / Pay Later (48 px tall; 102 px wide at 390 px).
- **Figures:** Due / Collecting / Left to pay always visible; the amounts shrink to fit their column.
- **Pay Later not approved:** the option is disabled with "Not approved"; a part payment is blocked with "collect the full ₹X, or call the office" (nothing is sent).
- **Pay Later chosen:** shows "Nothing collected now. ₹X goes on the customer's account." The button reads "Mark as delivered · Pay Later".
- **Fallback:** without migration 0021 the form is exactly the previous Cash / UPI form.

**Manager Pay Later:** a panel in Tiffin → customer profile, and in the Receivables account view:
- shows Allowed / Not allowed, delivery balance due, unpaid orders, oldest unpaid (date and days), open reviews, and last changed by / on;
- Allow / Stop with a confirmation;
- one request even on a double click.

**Finance → Receivables:** new tab, sidebar entry and phone section switch.
- **Summary:** total, PG, Tiffin, Delivery; ageing buckets that act as filters; unallocated credit; reviews.
- **Filters:** source, status, ageing, outstanding-since dates, "only to review", search (name, phone, room).
- **List:** cards on phones; a fixed-layout table with truncation from 768 px.
- **Paging:** 25 per page.
- **Loading:** a matching skeleton, no spinner. The tab's code loads on demand and is preloaded when idle (Finance page JS 32.4 kB, +0.5 kB over P0).

**Account view** (dialog):
- totals by source and the Pay Later panel;
- open balances with links to the source record;
- "Mark reviewed" with a note;
- **Statement** with dates, opening and closing balance, entries, delivered-day details per tiffin invoice and reversals marked;
- **Receive payment**.

**Receive payment:**
- amount received, method (Cash, UPI, Bank transfer, Cheque, Other), date, reference;
- a checkbox and amount per open balance;
- "Fill oldest first" only on request;
- a review step showing the allocation and what is left;
- one key per opened dialog and an in-flight guard.

Note: order payments are dated when recorded; the chosen date applies to rent and tiffin.

**Cashbook:** "Rent collected ₹X — refunds −₹Y · net ₹Z", the same for expenses, and a signed net that can be negative.

**Responsive (`p2_layout.js`, long names, amounts up to ₹98,99,901):**
- Receivables list, both search results, both account views, both statements and both receive-payment dialogs at 360 / 390 / 768 / 1024 / 1280 / 1440 px, plus the driver payment sheet at 360 / 390 px: **58 / 58 clean** (page overflow, text outside its box, clipping, text collisions).
- The text-collision probe was added after a screenshot showed the driver sheet's Due amount running into Collecting at 360 px. That was fixed; the probe reproduced it before the fix (56 / 58) and passes after.

---

## F. Test results (exact)

| Suite / check | Result |
|---|---|
| **Full automated suite** (`npm run test:safe`) | **62 suites: 59 passed, 0 failed, 3 skipped by design; exit 0** (final run, 2026-11-05) |
| `pg_p0_financial_integrity` (P0 regression) | 76 passed, 0 failed |
| `billing_period` (unit) | 34 passed, 0 failed |
| `pg_payments_receivables` (new) | **75 passed, 0 failed** |
| `pg_migrations_0020_0021` (new; fresh + upgrade + duplicate stop) | **15 passed, 0 failed** |
| `pg_schema_compat_0019` (new; code on an unmigrated database) | **12 passed, 0 failed** |
| Existing suites touched by this work | pg_money_flows 60/0 · invoicing 68/0 · pg_tiffin_management 36/0 · pg_delivery_sync 19/0 · pg_orders 38/0 |
| Browser, P2 screens (`p2_ui.js`) | **22 passed, 0 failed** |
| Browser, offline Pay Later (`p2_offline.js`) | **6 passed, 0 failed** |
| Responsive (`p2_layout.js`) | **58 / 58 clean** |
| TypeScript, app / tests | 0 errors / 0 errors |
| Production build (sandbox; throwaway DB address) | **passes**; shared JS 87.6 kB (unchanged); one existing warning (`emailAdapter.ts`) |

`pg_payments_receivables` covers:
- **Collections:** cash, UPI, part cash, part UPI, mixed with a UPI reversal while cash still counts, repeated reversal refused, custody rising only by cash taken.
- **Pay Later approval:** default off; driver refused; Manager / Owner changes audited with previous and new state; an unchanged repeat not audited.
- **Pay Later at the door:** no collection, no cashbook entry, no custody change; Pay Later with money refused; unapproved Pay Later and unapproved part payment accepted and flagged; paid in full not flagged; overpayment refused; another driver's stop refused for completion and for payment.
- **Offline after approval withdrawn:** two simultaneous syncs applied once; choice and evidence kept; managers notified; offline cash synced three times at once gives one collection; review closed once by a Manager, refused for drivers.
- **0020 in the app:** 5 simultaneous identical creates give 1 invoice; retry returns the same invoice; a mismatched key is refused; a new key gives a separate invoice; same subscription and month in two spellings at once gives one invoice and one clear refusal; a different subscription is allowed; monthly billing for "Dec 2041" sees both as billed.
- **Receivables:**
  - PG = rent ledger, with payments settling the oldest charge first;
  - tiffin = tiffin ledger, with unallocated payments shown as credit;
  - every account's statement closes at its Receivables total;
  - mid-range statement opening carried forward;
  - same phone gives two accounts;
  - sources add up to the total, and ageing plus credit equals the total;
  - pages don't overlap; source and review filters work.
- **Receive payment:**
  - five simultaneous identical payments recorded once, with one audit entry;
  - part payment;
  - one over-amount item refuses the whole payment, nothing recorded;
  - amount received must equal the amounts applied;
  - another account's balance refused; drivers refused; rent above the balance refused;
  - re-allocation stays Owner-only.
- **Cashbook:** June receipt, July refund on its own line (net −₹6,000; the old floored figure stays ₹0), months add up to the range, an empty month stays ₹0, statement June-only and from mid-June.

**Earlier full-suite runs in this phase:**
- **First:** 57 passed, 1 failed (`pg_money_flows`: "Tiffin customer payments stay Owner-only", ISSUE-010). I had widened direct tiffin payments to Managers. That was narrowed: the direct path stays Owner-only, and Managers record tiffin payments only through Receive payment, for a specific invoice (D6 as recommended). The existing test was not changed.
- **Second:** 58 / 0 / 3.

**Skipped by design:** `live_postgresql_integration`, `task01b_74`, `task01b_75` (real local database or real email).

---

## G. Performance

**Receivables on a production build**, seeded disposable database (30,000 delivered orders, 22,500 collections, 3,000 invoices, 300 residents × 12 months of rent; 2,025 accounts owing ₹83,75,000):

| Request | First version cold / warm | Final cold / warm |
|---|---:|---:|
| List, default page | 6,033 / 5,206 ms | **584 / 272 ms** |
| List, page 3 | 5,356 / 5,332 | **299 / 269** |
| List, Delivery only | 4,556 / 4,709 | **218 / 230** |
| List, over 60 days | 5,155 / 5,307 | **199 / 267** |
| List, search | 8,392 / 8,879 | **320 / 314** |
| Account (customer) | 35 / 25 | **32 / 27** |
| Statement (customer, 31 entries) | 59 / 49 | **65 / 62** |
| Statement (resident) | 32 / 27 | **27 / 21** |

**What made the first version slow:**
- account names were joined on built strings (no index);
- each order ran two subqueries;
- the work was repeated four times.

The final query joins on primary keys, sums order lines and collections once, and returns page, totals and ageing in one statement. **Totals are identical** before and after.

**In-app navigation to Receivables** (sidebar, same build and data):
- first visit: 1,748 ms (tab code and the first uncached aggregation over 30,000 orders);
- return visits: **219–310 ms (median 244 ms)**.

**Navigation benchmark** (production build, e2e database, same script as the baseline): measured twice.
- **Straight after the build:** 559 ms first-visit median and 477 ms return-visit median. Every page was slower, including pages with no new code. The machine was loaded at the time: CPU 45% while idle, 1.1 GB of RAM free, and 34.6 of 38.4 GB of memory committed.
- **Run again with both builds side by side**, alternating, same database and load:

| | First visit, median / worst | Return visit, median / worst | Destination frame, worst |
|---|---|---|---|
| P0 build, round 1 | 133 / 391 ms | 73 / 104 ms | 137 ms |
| **This build, round 1** | **148 / 399** | **138 / 1,504** | **148 → 294** |
| P0 build, round 2 | 126 / 927 | 92 / 215 | 206 |
| **This build, round 2** | **137 / 424** | **98 / 206** | **146 → 137** |
| Baseline in the brief (P0 report) | 216 / 512 | 129 / 283 | 150 |

This build is within run-to-run noise of P0, with one outlier: a single 1.5 s return visit in round 1. Navigation stress: **20 / 20**.

**Driver payment:**
- one extra yes/no field per stop, joined in the existing query;
- one extra order update inside the existing completion transaction;
- no extra request;
- no polling anywhere.

---

## H. Database safety

**Databases used for writes**, all on the disposable container `rn_erp_verify_pg` (in-memory storage, 127.0.0.1:55432); identities checked before use:

| Database | Use |
|---|---|
| `rn_erp_verify_test` | All automated suites |
| `rn_erp_verify_mig_fresh_*_test`, `rn_erp_verify_mig_upgrade_*_test`, `rn_erp_verify_compat_*_test` | Created and dropped by the migration and compatibility suites |
| `rn_erp_verify_e2e_test` | Migrated to 0021 after a clean scan; browser tests through the app's API |
| `rn_erp_verify_large_test` | Migrated to 0021 after a clean scan |
| `rn_erp_verify_recv_bench_test` | Created, migrated, seeded with SQL for the benchmark |

**Confirmations:**
- **No Neon access**, no production migration, no production configuration change.
- **No write to the local development database** (`ravinarayana_erp_local`, port 5432).
- `.env.local` untouched.
- No production build or start in the working tree; builds only in `%TEMP%\rn-erp-test-sandbox`.
- No commit, push or deployment.

---

## I. Outstanding risks and decisions

1. **Before release:**
   - run `scripts/scan-invoice-duplicates.js` read-only against production;
   - approve migrations 0020 and 0021;
   - apply them before or after the deploy (the code works either way, decision 3).
2. **D10–D14 unresolved**, existing behaviour kept:
   - **D10:** one rent invoice per resident per month — not enforced; resident invoices are not unique by month.
   - **D11:** order numbering — orders are shown by meal and date, no number.
   - **D12:** new PG charge types — none added.
   - **D13:** package pause and proration — unchanged.
   - **D14:** overdue definition — none; ageing is by outstanding-since date.
3. **Cash handover correction** (a reversal of a handover entry stays refused) and **individual cash-collection reversal** need an additive migration (`delivery_collections.reversed_at`, `reversed_by`, `reason`) and a correction workflow. Not done.
4. **Order payments taken in Receive payment are dated when recorded**, not on the date chosen in the dialog (the dialog says so). Matching dates would mean changing the delivery collection service.
5. **Drivers cannot record a later payment in the app** (the server allows it for their own stops). Decide whether to add it.
6. **No UPI "pending verification" state exists**; UPI is booked when recorded, as before.
7. **Unallocated tiffin payments** show as credit and lower the account. Allocating them stays an Owner action on the Invoices tab.
8. **Daily breakdown on tiffin statements** lists the delivery tasks linked to the invoice. A monthly package billed without linked deliveries shows no days. Nothing is invented.
9. **Receivables list cost grows with history:** ~270 ms warm at 30,000 orders. If history grows tenfold, add a default "outstanding since" window or a maintained summary.
10. **Global loading redesign (P3)** deferred (§A).
11. **The navigation figures depend on machine load** (§G); a measurement on a quiet machine would remove the doubt.

---

## J. Release readiness

**Ready for a separate migration and release approval.** All P0–P2 scope is implemented and tested:
- the full automated suite, new concurrency, migration and compatibility suites;
- browser, offline and responsive checks;
- type-checks and the production build.

There are no known failing tests and no open defects in the implemented scope.

**Required before release:**
1. the read-only duplicate scan on production;
2. approval of 0020 and 0021;
3. your review of §I.
