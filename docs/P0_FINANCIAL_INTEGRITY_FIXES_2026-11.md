# P0 financial integrity fixes — November 2026

Date: 2026-11-05. Scope: the six defects in `docs/ERP_FEATURE_AND_UI_ANALYSIS_2026-11.md` §2. Status: **implemented and verified; not committed, pushed or deployed.** No schema change, no migration, no Pay Later, Receivables or statement work.

> **Update 2026-11-05:** All six fixes were re-verified at the start of P1–P2 (76/0) and again in the final full run. Two areas were extended later: tiffin payments can now also be recorded by a Manager through Finance → Receivables for a specific invoice (the direct path stays Owner-only), and invoice creation gained an idempotency key and a one-invoice-per-subscription-and-month rule (migration 0020). See `docs/FINANCIAL_SYSTEM_IMPLEMENTATION_P0_P2_2026-11.md`.

---

## A. Initial working-tree state

Recorded before any change (`git status --porcelain`, HEAD `a3a3ccc`):

- **169 entries:** 105 modified, 1 deleted (`app/(management)/loading.tsx`), 63 untracked.
- All of them came from the earlier performance, verification and analysis rounds and were treated as yours.
- The untracked files include the four earlier migration files `0016`–`0019` and `scratch/test-full-auth-flow.js`. Both were left alone; neither was opened, run or changed.

**Preservation:**
- The nine files expected to change were copied to the session scratchpad before editing, and every change was made in place on top of the existing modifications.
- Nothing was reset, restored, stashed or cleaned.
- After the work, `git status` lists the same 169 entries plus three new untracked files (§B).

**One mistake, corrected:** my scripted edits first rewrote three CRLF files with LF endings (`financeService.ts`, `rentGenerationService.ts`, `deliveryService.ts`). Their original CRLF endings were restored, and the diffs against the saved copies now show only the code changes.

---

## B. Six-bug implementation table

| Bug | Root cause | Files changed (this phase) | Fix | Regression test | Result |
|---|---|---|---|---|---|
| **1. Unallocated tiffin money overstated** | `getTiffinCustomerBalance` joined payments to allocations and summed `t.amount` per joined row, so a payment with *n* allocations was counted *n* times | `server/tiffin/tiffinBillingService.ts` (+14 −8) | Per posted payment: amount − its allocations (correlated subquery on the existing `idx_inv_alloc_payment`), then summed. Reversed payments are excluded with their allocations. | `pg_p0_financial_integrity` §1 (12 checks, including invariants) | **Fixed** (verified) |
| **2. Concurrent allocations over-allocate** | `allocatePaymentToInvoice` validated the invoice and payment **before** the transaction without locks, then wrote `amount_paid`/`balance_due` from those stale reads (lost update) | `server/finance/invoiceService.ts` (allocation function rewritten in place) | All checks run **inside** the transaction on rows locked `FOR UPDATE` in a fixed order (payment, then invoice, the order a reversal uses). The remaining payment amount and the invoice balance are recomputed under the locks; any failure rolls back the whole transaction. | §2 (24 checks): 3 race types × 5 rounds of real parallel requests, a retry after the refused request, invariant checks on every invoice | **Fixed** (verified) |
| **3. Rent month charged twice** | Issuing a resident invoice linked an existing rent charge only on **exact** period text; "Nov 2026" vs "November 2026" (or another browser language) posted a second `RENT_CHARGE`. Separately, the same draft issued twice at the same moment took two numbers and posted two charges, because the DRAFT check ran outside the transaction. The monthly rent run also missed a hand-entered "Nov 2026" charge dated outside the month. | `server/finance/billingPeriod.ts` (**new**, 49 lines); `invoiceService.ts` (shared `resolveResidentRentCharge` used by issue and auto-issue; issue re-checks DRAFT under a row lock); `rentGenerationService.ts` (+11 −4) | (a) `canonicalBillingMonth()` turns "Nov 2026", "NOVEMBER-2026", "2026-11", "11/2026"… into `2026-11`; text that is not a month returns null and keeps the old exact-text behaviour. (b) An unbilled rent charge of the **same month and same amount** is linked even when spelled differently (exact-text linking unchanged). (c) A charge can be linked to only one invoice (guarded update). (d) Issues for a month take the rent run's own lock for that month. (e) The invoice row is locked and re-checked as DRAFT. (f) The rent run recognises any spelling of its month. | §3 (14 checks, including two concurrency cases); `billing_period` unit suite (34 checks) | **Fixed** (verified), with one policy question left open (§F.1) |
| **4. Reversing a delivery collection leaves the order paid** | The generic reversal flipped the UPI ledger entry to REVERSED but nothing else. The order's paid amount comes from `delivery_collections` and the task's copied total, which still counted the reversed money. | `server/finance/financeService.ts` (+34 −4); `server/delivery/deliveryService.ts` (+90 −8); `server/delivery/deliveryRules.ts` (+10, `activeCollectionSql`); `server/delivery/deliveryOps.ts` (+4); `server/reports/reportsService.ts` (+3 −2) | A collection counts unless its own cashbook entry is REVERSED (derived from existing data; no new column; the row is kept as history). Applied to the order balance, the over-collection cap, staff UPI totals and the delivery and cash-custody reports. In the reversal's transaction the task is locked, its copied total/status/method are recomputed from the collections that still count, and the delivery timeline records the reversal. **A delivery staff handover entry** (one entry for several cash collections) is refused from the cashbook with an explanation (§F.2). | §4 (10 checks) | **Fixed** for UPI collections (verified); cash handover reversal deliberately refused |
| **5. "Collect balance" new key on every click** | The task panel built the key as `bal_<task>_<Date.now()>` at click time, so a retry after a lost response (server already committed) was a new payment. Its only guard was React state, which updates after a render. | `modules/delivery/ops/TaskPanel.tsx` (+12 −3, manager panel only, not the driver app); `server/delivery/deliveryService.ts` (key payload check) | One key per opened "Collect balance", kept for retries and cleared only after success, plus a synchronous in-flight guard. The server was already authoritative for a repeated key (task row lock plus the unique key on `delivery_collections`). It now also **refuses** a key reused with a different amount or method instead of silently accepting it. | §5 (6 checks) + browser test `collect_balance_ui.js` (6 checks: dropped connection then retry, same-instant triple click, new collection) | **Fixed** (verified) |
| **6. Reversal deletes allocation history** | `reverseTransaction` ran `DELETE FROM invoice_payment_allocations` for every allocation of the reversed payment | `financeService.ts` (same edit as bug 4); `invoiceService.ts` (allocation list carries `paymentReversed`); `types/index.ts` (+2); `modules/finance/components/modals/PrintableInvoiceModal.tsx` (+3, marks reversed allocations) | No delete. **An allocation counts only while its payment is POSTED** (a reversal is final), so the rows stay as history and automatically stop counting. Invoice rows are locked `FOR UPDATE` before their paid amount is reduced (closing a lost-update window with concurrent allocations). The invoice view lists the allocation as "Payment reversed", struck through. | §6 (9 checks) | **Fixed without a schema change** (verified) |

New test files: `tests/pg_p0_financial_integrity.test.ts` (76 checks: 1 setup + 12 + 24 + 14 + 10 + 6 + 9) and `tests/billing_period.test.ts` (34 checks). No existing test was modified.

---

## C. Financial correctness evidence (before vs after)

The same regression suite (`pg_p0_financial_integrity`) was run twice against the throwaway test database:

- **before:** the original code, in the sandbox copy only, with the six changed service files restored from the pre-edit copies;
- **after:** the fixed code.

| | Before (original code) | After (fixed) |
|---|---|---|
| Suite result | **35 passed, 41 failed** | **76 passed, 0 failed** |

Some section 3 "before" failures are knock-on effects. Once a resident had a duplicate charge, later per-resident counts in the same section were off by one too.

**Bug 1 — the reproduction.** ₹1,000 payment, ₹300 and ₹200 allocated to two invoices.

| | Before | After |
|---|---|---|
| Customer unallocated (service) | **₹1,500** | **₹500** |
| Old query on the same rows | ₹1,500 | (no longer used) |
| Two payments (₹400 + ₹700) on one ₹1,000 invoice | wrong | ₹100 |
| Partly + fully allocated payments | wrong | ₹750 |
| A reversed ₹600 payment | — | stops counting (₹1,350 → ₹750) |
| Other customers | — | unaffected |

**Bug 2 — concurrency.** 5 rounds of each race; parallel requests through the service layer.

| Race | Before (every round) | After (every round) |
|---|---|---|
| ₹1,000 payment, two simultaneous ₹600 allocations | **₹1,200 allocated**, both "succeeded" | one succeeds, ₹600; the retry of the remaining ₹400 succeeds |
| ₹1,000 invoice, two simultaneous ₹700 allocations | **₹1,400 allocated** to a ₹1,000 invoice | one succeeds, ₹700 |
| ₹1,000 invoice, two open-amount allocations | invoice says **₹700 paid** while its rows total **₹1,400**; status PARTIALLY_PAID | ₹700 + ₹300 = ₹1,000, PAID |
| Invariant: stored paid = active allocations; paid + due = total | **10 invoices violated it** | all hold |

**Bug 3 — rent month.**

| Case | Before | After |
|---|---|---|
| "November 2041" charge, invoice "Nov 2041" | 2 rent charges | **1** (linked) |
| Each of "  november   2041 ", "NOVEMBER-2041", "2041-11", "11/2041", "Nov. 2041" | 2 charges each | 1 each |
| Same draft issued twice at the same moment | **2 issued, 2 charges** | 1 issued, 1 charge; the other refused ("Only DRAFT invoices can be issued") |
| Two drafts, same month, issued at once, one existing charge | charge linked to neither (3 charges) | existing charge linked to exactly one invoice; the other posts its own charge (current policy, §F.1) |
| Different residents, same month | — | one each |
| Same resident, different month | — | a new charge for the new month |
| Different amount in a charged month (maintenance) | — | own charge, unchanged behaviour |
| Non-month text ("P0 deposit top-up") | — | unchanged behaviour |
| Rent run with a "Nov 2026" manual charge dated 30 Oct | status `TO_CHARGE` (**would charge November again**) | `MANUAL_CHARGE_EXISTS` |

**Bug 4 — reversed delivery collection** (order due ₹300).

| Step | Before | After |
|---|---|---|
| ₹300 UPI at the door, entry reversed | collected ₹300, **balance ₹0**, COLLECTED | collected ₹0, **balance ₹300**, NONE |
| Same entry reversed again | — | refused, balance unchanged |
| Driver's UPI collected | stayed ₹300 | ₹300 → ₹0 |
| Driver's cash collected / held | — | unchanged |
| ₹100 UPI + ₹50 UPI + ₹50 cash, the ₹50 UPI reversed | collected ₹200, balance ₹100 | **₹150 / ₹150**; the other two collections untouched |
| Collecting the real remaining ₹150 after that | **refused** ("only ₹100 outstanding") | accepted; order fully paid; nothing more can be collected |
| Cash handover entry (covers several collections) | **reversed silently**; orders and custody still say received | refused with an explanation; entry stays POSTED |

**Bug 5 — "Collect balance".**

| Case | Before | After |
|---|---|---|
| Browser: first Confirm commits on the server but the browser sees a dropped connection; manager presses Confirm again | the old panel would send a new key, so the payment is recorded twice. Reproduced on the API: two ₹20 requests with two keys → **two ₹20 collections** | the retry sends the **same key**; one ₹100 collection |
| Same-instant triple click on Confirm | — | **1** request |
| Next collection after a completed one | — | new key, recorded (₹150 in 2 rows) |
| 5 simultaneous identical API requests | 1 collection (the server already handled it) | 1 collection, all 5 answered |
| Repeated identical requests | — | still 1 |
| Same key, different amount | **accepted silently** | refused |
| Two independent collections at once | — | both recorded |
| Two simultaneous ₹50 against a ₹50 balance | — | one recorded |

**Bug 6 — reversed allocated payment** (₹500 payment allocated ₹300 + ₹200).

| | Before | After |
|---|---|---|
| Allocation rows after reversal | **0 of 2** (deleted) | **2 of 2** kept |
| Invoice view | allocation gone | lists it as "Payment reversed" |
| Invoices | — | back to ₹0 paid / ISSUED |
| Repeated reversal | — | refused, no change |
| Customer's unallocated money | — | unaffected (₹0) |
| A new ₹300 payment on the first invoice | invoice showed 1 allocation | PAID, history shows both allocations |
| Invariant: paid = active allocations | — | holds |

### Invariants (your list of 12) and where each is checked

| # | Invariant | Checked by |
|---|---|---|
| 1, 2 | Payment / invoice never over-allocated | §2 races; `invoiceInvariants()` after §1, §2, §6 |
| 3, 4 | Reversed payment / allocation does not count | §1 (₹600 reversal), §6 |
| 5, 6 | Reversed collection does not count; balance follows valid collections | §4 |
| 7 | One charge per rent month, as far as current policy defines it | §3 and §F.1 |
| 8 | Retry creates no second record | §3 (re-issue), §5, browser test |
| 9 | Reversal keeps history | §6 (allocations), §4 (collection rows kept; timeline event; audit metadata `allocationsKept` and `deliveryCollection`) |
| 10 | Failed transaction leaves nothing | §2 refused allocations leave no row (sum checks) |
| 11 | Cash custody unchanged by UPI and reversals | §4 custody check |
| 12 | Audit trail kept | Every changed mutation still writes its audit event in the same transaction; the reversal audit adds `allocationsKept` and `deliveryCollection` |

---

## D. Test results (exact)

| Check | Result |
|---|---|
| `pg_p0_financial_integrity` (new, PostgreSQL, real concurrency) | **76 passed, 0 failed** |
| `billing_period` (new, unit) | **34 passed, 0 failed** |
| Browser test, "Collect balance" (`collect_balance_ui.js`, dev server :3102 on the working tree, throwaway e2e DB) | **6 passed, 0 failed** |
| Related existing suites | invoicing 68/0 · pg_money_flows 60/0 · pg_rent_generation 21/0 · pg_tiffin_management 36/0 · task01b_55_reporting 92/0 · task01b_64_gstin_validation 63/0 |
| Full automated suite (`npm run test:safe`, 59 suites) | **56 passed, 0 failed, 3 skipped** (exit 0; final code; the previous baseline was 54/0/3 of 57 suites, plus the 2 new suites) |
| TypeScript, app / tests | **0 errors / 0 errors** |
| Production build (sandbox copy, explicit throwaway database address) | **passes**; shared JS 87.6 kB (unchanged); one existing warning (`emailAdapter.ts` dynamic require) |

**One regression found and fixed during this phase.** My first version of the bug 3 fix refused any second resident invoice for a month that already had an invoiced rent charge. Two existing suites (`task01b_55_reporting`, `task01b_64_gstin_validation`) failed. They issue several legitimate invoices to one resident for the same month ("Advance Utilities" and "Maintenance Dues" for 2026-10; a GST invoice and a regular bill for October). Every resident invoice posts as a rent charge, so refusing them would have been a new billing policy, not a bug fix. I narrowed the fix to the actual defect (§B, bug 3) and left the policy question to you (§F.1). The existing tests were not changed. The full-suite run with the first version: 54 passed, 2 failed (those two), 3 skipped. The final run is in the table above.

**Skipped by design:** `live_postgresql_integration`, `task01b_74_local_admin_and_manifest`, `task01b_75_complete_auth_flow` need the real local database or real email.

---

## E. Database safety

- **No migration** created, modified or run. **No schema change**: no table, column, index or constraint was added or altered.
- **Neon:** not contacted. **`.env.local`:** unchanged.
- **Your local database** (`ravinarayana_erp_local`, container `ravinarayana-postgres-local`, port 5432): not used.
- **Database writes went only to the throwaway container** `rn_erp_verify_pg`. It runs in memory, listens on 127.0.0.1:55432, and its identity was checked before the runs (`current_database()` = `rn_erp_verify_test`).
  - `rn_erp_verify_test`: all automated suites.
  - `rn_erp_verify_e2e_test`: the browser test, through the app's own API.
- **No production build or start in the working tree**; builds ran only in `%TEMP%\rn-erp-test-sandbox`.
- The "before" evidence ran against original files placed **only** in that sandbox copy.
- No commit, push or deployment. The delivery staff app, the Android shell (`mobile/`) and Kitchen were not changed.

---

## F. Remaining issues

1. **Policy decision — a second rent-typed invoice for the same month.** Every resident invoice posts its total as a `RENT_CHARGE`, so the ledger cannot tell rent from utilities, maintenance or a GST re-bill. The fix prevents the duplicate that was a bug: the same month and amount spelled differently, and the same draft issued twice. It does **not** refuse a deliberate second invoice for a month, because existing tests show that as current behaviour. If you want "one rent charge per resident per month" enforced, the clean way is to give non-rent resident charges their own category or type first (analysis D10/D12), then refuse a second **rent** charge.
2. **Cash handover entries cannot be reversed from the Cashbook** (new refusal, explained on screen). One entry covers many cash collections, and reversing it would leave custody and orders saying the money was received. Correcting an accepted handover needs a defined workflow (which collections, who holds the cash). Policy decision.
3. **Individual cash collections cannot be reversed** (there was no way before either). They have no ledger entry of their own and `delivery_collections` has no status column, so a correction needs an additive migration (`delivery_collections.reversed_at`, `reversed_by`, `reason`, or correction rows). Proposed for P2.
4. **Allocation history** is kept by deriving "active" from the payment's status. That is exact today, because allocations only stop counting when their payment is reversed. If allocations ever need to be undone on their own (moving a payment between invoices), add `invoice_payment_allocations.reversed_at` / `reversed_by` (additive migration, P2).
5. **An order with a reversed collection stays locked for editing and cancelling** (`orderLifecycleService` counts any collection row). That is conservative and unchanged; relaxing it is a decision.
6. **Invoice duplicates on creation** (two identical "create invoice" requests at the same instant) still need migration 0020.
7. **Manual rent charges** (Cashbook → Rent charge) still accept any period text and can be entered twice by hand. That is intentional for manual entries, but worth a warning in the form once D10 is decided.
8. **Tiffin invoice issue** still links an existing tiffin charge by exact period text. Low risk (tiffin billing writes its own period labels), but the same canonical matching could be applied after review.
9. **Navigation performance was re-measured** on the final production build (sandbox, throwaway e2e database, same script and route set as the reference). It is within run-to-run noise. The script reproduces the reference figures exactly from its saved file.

   | Measure | Reference (4 Nov) | Final build (5 Nov) |
   |---|---|---|
   | First visits, median / worst | 222 / 684 ms | **216 / 512 ms** |
   | Return visits, median / worst | 125 / 245 ms | **129 / 283 ms** |
   | Destination frame shown, worst | 164 ms | **150 ms** |
   | Navigation stress | 20/20 | **20/20**, no console errors |

   Database cost of the fixes:
   - **Bug 1:** one correlated subquery on the indexed `payment_transaction_id`.
   - **Bug 2:** two primary-key row locks (no extra round trips; the invoice is read once inside the transaction instead of a full invoice load before it).
   - **Bug 3:** one row lock, one advisory lock and one indexed query of the resident's unbilled rent charges, only when an invoice is issued.
   - **Bug 4:** a `NOT EXISTS` primary-key lookup per collection row in balance queries; three small queries in a reversal.
   - **Bug 5:** none on the server; a ref on the client.

   No polling, no extra page refreshes.

---

## G. Next-phase recommendations (not implemented)

- **Migration 0020:**
  - `invoices.idempotency_key` with a partial unique index, a stable key per opened invoice form, and replay or mismatch rules as for ledger payments;
  - the partial unique index on `(customer_id, subscription_id, billing_period) WHERE status <> 'CANCELLED' AND invoice_category = 'TIFFIN'`, after a read-only duplicate check on production data.
  - Optionally include the P2 history columns from §F.3–4, so corrections have a non-destructive home.
- **Customer identity and Pay Later eligibility:**
  - one account per `tiffin_customers` row, matched by `customer_id` only (never by phone);
  - `pay_later_enabled` set by Owner/Manager, audited;
  - the driver receives only a boolean per stop;
  - no credit limit until you decide one (analysis D1–D5).
- **Delivery payment state:**
  - `orders.payment_choice` (CASH, UPI, PAY_LATER), `payment_status` (NOT_DUE, UNPAID, PARTIALLY_PAID, PAID), `amount_due` and `amount_collected`, maintained in the same transactions as completion and collection;
  - `amount_collected` must use the same "active collection" rule introduced here (`activeCollectionSql`), so reversals keep working.
- **Offline sync:**
  - add `paymentChoice` to the queued payload and to the sanitiser's allowed values;
  - the receivable is a state on the order, so replays stay idempotent through the existing status guard and per-stop key;
  - eligibility is decided by the server at apply time (flag, never reject a real delivery).
- **Unified Receivables:** read-only aggregation over three sources:
  - rent ledger: Σ charges − settlements;
  - tiffin ledger: Σ charges − customer payments; invoice `balance_due` for detail;
  - order balances: `amount_due − amount_collected` with a partial index on unpaid orders.

  Server-side aggregation and pagination; no copying of balances; the bug 1 query shape (per-payment subquery) for any "unallocated" figure.
