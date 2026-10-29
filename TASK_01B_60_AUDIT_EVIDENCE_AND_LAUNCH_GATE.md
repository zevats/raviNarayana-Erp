# Task 01B.60 — Audit Evidence Validation & Production Launch Gate Report

**Repository:** `zevats/raviNarayana-Erp`  
**Branch:** `master`  
**Evaluation Mode:** Critical Application Audit & Production Launch Gate (Read-Only)  
**Evaluation Date:** 24 October 2026  
**Auditor:** Senior Application Auditor & Release Manager  

---

## 1. Executive Recommendation: Controlled Pilot vs Full Production

### 1.1 Final Recommendation Summary
- **Full Production Release:** **BLOCKED**
- **Controlled Pilot Deployment:** **CONDITIONAL GO** (Subject to resolving 3 operational launch blockers)

### 1.2 Rationale
A rigorous, critical examination of [`TASK_01B_59_FINAL_PRODUCTION_READINESS_AUDIT.md`](file:///TASK_01B_59_FINAL_PRODUCTION_READINESS_AUDIT.md) against the actual codebase, schemas, tests, and task reports revealed that while the core business logic is remarkably extensive and all 22 test suites pass on SQLite (1,860+ assertions), **several claims in Task 01B.59 were either overstated, partially verified, or conflated tested software behavior with untested operational infrastructure**.

Specifically:
1. **Closing Lock Discrepancy:** The claim that daily cashbook closing prevents backdated transactions via HTTP 422 is **factually unsupported** in the transaction services. The closing lock only blocks modifying the daily closing record itself in [`cashbookClosingService.ts`](file:///apps/erp/src/server/finance/cashbookClosingService.ts#L432); [`financeService.ts`](file:///apps/erp/src/server/finance/financeService.ts) does not check daily closing locks when inserting `recordPayment`, `recordExpense`, or `recordRentCharge`.
2. **Cashbook Reporting Inconsistency on Deposit Application:** While [`cashbookClosingService.ts:142`](file:///apps/erp/src/server/finance/cashbookClosingService.ts#L142) properly excludes `category = 'DEPOSIT_APPLICATION'` from cash movements, [`financeService.ts:868`](file:///apps/erp/src/server/finance/financeService.ts#L868) (`getCashbookSummary`) sums all `RENT_PAYMENT` transactions without filtering out `DEPOSIT_APPLICATION`, causing non-cash deposit offsets to inflate cash inflow and net cash in `getCashbookSummary`.
3. **GST Rate & Validation Discrepancy:** Task 01B.59 stated GST rates are `(0%, 5%, 12%)`. In reality, both the backend [`invoiceService.ts:102`](file:///apps/erp/src/server/finance/invoiceService.ts#L102) and UI [`CreateInvoiceModal.tsx:453`](file:///apps/erp/src/modules/finance/components/modals/CreateInvoiceModal.tsx#L453) support `18%` as well. Furthermore, GSTIN validation checks only string non-emptiness, not genuine 15-character statutory GSTIN syntax or state code consistency.
4. **Doorstep UPI Collections Ledger Disconnection:** Doorstep UPI collections are captured on delivery tasks, but unlike physical cash handovers, they are never posted to the authoritative financial ledger (`financial_transactions`), requiring manual external accounting entry.
5. **Runtime Parity:** All 22 test suites run against ephemeral SQLite test doubles (`test_*.db`). Real PostgreSQL execution against remote Neon was not executed in the test run because no live test connection was provided, meaning PostgreSQL concurrency locking (`FOR UPDATE`) remains verified only by code structure, not live integration assertion.

---

## 2. Evidence Matrix

| Area / Feature | Claim in Task 01B.59 | Source Location & Test | Actual Observed Evidence | Confidence Level | Unresolved Risk / Gap |
| :--- | :--- | :--- | :--- | :---: | :--- |
| **GST Tax Rates** | Supports 0%, 5%, 12% | [`invoiceService.ts:102`](file:///apps/erp/src/server/finance/invoiceService.ts#L102), [`CreateInvoiceModal.tsx:453`](file:///apps/erp/src/modules/finance/components/modals/CreateInvoiceModal.tsx#L453), [`tests/invoicing.test.ts`](file:///tests/invoicing.test.ts) | Implementation supports `[0, 5, 12, 18]`. UI offers 0%, 5%, 12%, 18%. Tests only test 12% and 5%. 18% is untested. | **High (Code Verified)** | 18% rate is implemented and available in UI but lacks explicit regression test. |
| **GSTIN Format Validation** | Authentic registered GSTIN required | [`invoiceService.ts:323-328`](file:///apps/erp/src/server/finance/invoiceService.ts#L323-L328), [`tests/invoicing.test.ts:330-355`](file:///tests/invoicing.test.ts#L330-L355) | Code only checks `trim().length > 0`. Any string (e.g. `"INVALID"`) is accepted if non-empty. Zero regex or checksum validation. | **Medium (Partial)** | Malformed GSTINs can be persisted on tax invoices, creating legal compliance liability. |
| **Sequential Invoice Numbering** | "Gapless" sequential numbering (`INV-YYYY-XXXX`) | [`invoiceService.ts:166-190, 1076`](file:///apps/erp/src/server/finance/invoiceService.ts#L166-L190), [`tests/invoicing.test.ts:204-250`](file:///tests/invoicing.test.ts#L204-L250) | Counter increments atomically. However, cancelling an invoice does NOT reuse or decrement the number. Numbers of active bills have gaps when cancellations occur. | **High (Code Verified)** | Terminology "gapless" is inaccurate. It is strictly monotonically increasing; gaps occur upon invoice cancellation. |
| **Deposit Application Cash Movement** | Deposit application creates zero cash inflow | [`residentSettlementService.ts:320-338`](file:///apps/erp/src/server/residents/residentSettlementService.ts#L320-L338), [`cashbookClosingService.ts:142`](file:///apps/erp/src/server/finance/cashbookClosingService.ts#L142), [`financeService.ts:868`](file:///apps/erp/src/server/finance/financeService.ts#L868) | `cashbookClosingService` properly excludes `category = 'DEPOSIT_APPLICATION'`. But `financeService.ts:getCashbookSummary` includes it in `rentCollected`, causing cashbook inflation in reports. | **Low (Discrepancy Confirmed)** | Discrepancy between Cashbook Summary API and Daily Closing Ledger. Non-cash deposit offsets inflate `getCashbookSummary` net cash. |
| **Deposit Refund Cash Outflow** | Deposit refund creates cash outflow | [`residentSettlementService.ts:341-365`](file:///apps/erp/src/server/residents/residentSettlementService.ts#L341-L365), [`tests/task01b_52_settlement.test.ts:856-880`](file:///tests/task01b_52_settlement.test.ts#L856-L880) | `DEPOSIT_REFUND` transaction inserted with `status = 'POSTED'`. Cashbook properly decrements net deposits held. | **High (Verified)** | None. Correctly implemented and tested. |
| **Daily Closing Backdate Lock** | Closing lock prevents backdated transaction insertion | [`cashbookClosingService.ts:431-433`](file:///apps/erp/src/server/finance/cashbookClosingService.ts#L431-L433), [`financeService.ts`](file:///apps/erp/src/server/finance/financeService.ts) | Closing lock only prevents updating the daily closing record itself. `financeService.ts` (`recordPayment`, `recordExpense`) does NOT check closing date lock. Backdated entries are permitted. | **Unverified / Refuted** | High financial integrity risk: Staff can insert transactions on previously finalized days without reopening the close. |
| **Driver Doorstep Cash Handover** | Cash held in custody; accepted cash enters cashbook | [`deliveryService.ts:1810-1857`](file:///apps/erp/src/server/delivery/deliveryService.ts#L1810-L1857), [`tests/task01b_58_delivery_handover.test.ts`](file:///tests/task01b_58_delivery_handover.test.ts) | Cash declared by driver, accepted by manager, variance checked, and `TIFFIN_PAYMENT` posted to `financial_transactions`. Self-acceptance forbidden. | **High (Verified)** | None. Correctly implemented and tested for physical cash. |
| **Doorstep UPI Collection Ledger Integration** | Doorstep collections flow to financial ledger | [`deliveryService.ts:1610-1640, 1851`](file:///apps/erp/src/server/delivery/deliveryService.ts#L1610-L1640) | UPI collections are recorded on `delivery_tasks`, but `acceptCashHandover` explicitly filters `collected_payment_method = 'CASH'`. Zero ledger transaction is posted for UPI doorstep payments. | **Medium (Partial)** | UPI collections remain in delivery task metadata and do not automatically reach `financial_transactions`. Requires manual entry. |
| **Offline Delivery Queue Resilience** | Durable offline queue with UUID idempotency and 409 conflict detection | [`offlineQueue.ts:40-160`](file:///apps/erp/src/modules/delivery/offlineQueue.ts#L40-L160), [`tests/task01b_58_delivery_handover.test.ts:700-780`](file:///tests/task01b_58_delivery_handover.test.ts#L700-L780) | Client queue in `localStorage` with client idempotency key. Replay idempotent. Concurrent reassignments rejected with 409. | **High (Verified)** | Shared device cache: queue in `localStorage` persists across unmount unless explicitly cleared on logout. |
| **Session Security & Secrets** | `SESSION_SECRET` is mandatory production secret | [`auth.ts:306-378`](file:///apps/erp/src/server/authentication/auth.ts#L306-L378), [`env.ts`](file:///apps/erp/src/server/database/env.ts) | `SESSION_SECRET` is NOT used anywhere in the codebase. Sessions use 256-bit random bearer tokens hashed with SHA-256 at rest in database table `sessions`. | **High (Code Verified)** | Documentation inaccuracy: Claimed `SESSION_SECRET` was required, but authentication architecture is actually stateful database-persisted. |
| **Production DB & Migration Parity** | 12 PostgreSQL migrations match 20 SQLite test migrations | [`_journal.json`](file:///apps/erp/src/server/database/drizzle/meta/_journal.json), [`sqliteMigrations.ts`](file:///tests/helpers/sqliteMigrations.ts) | 12 Drizzle PostgreSQL SQL files (0000–0011) registered. 20 SQLite migrations (V1–V20) match schema structurally. All 22 test suites run on SQLite. | **Medium (Parity by Schema)** | Concurrency row locking (`FOR UPDATE`) is active in code for Postgres, but test pipeline runs Better-SQLite3 with immediate lock emulation. |

---

## 3. GST Discrepancy Resolution

### 3.1 Comparison of Requirements vs Implementation vs Audit Summary
- **PRD / Task 01B.42 Requirement:** [`docs/PROJECT_REQUIREMENTS.md:361`](file:///docs/PROJECT_REQUIREMENTS.md#L361) specifies: *"Exact GSTIN and tax rates (e.g. 5% on tiffin without ITC vs 12% on rooms)."*
- **Actual Code Implementation:**
  - In [`invoiceService.ts:102-104`](file:///apps/erp/src/server/finance/invoiceService.ts#L102-L104):
    ```ts
    taxRate = Number(item.taxRate ?? 0);
    if (![0, 5, 12, 18].includes(taxRate)) {
      throw new Error(`Unsupported GST tax rate '${taxRate}%'. Supported rates are 0%, 5%, 12%, 18%.`);
    }
    ```
  - In [`CreateInvoiceModal.tsx:450-454`](file:///apps/erp/src/modules/finance/components/modals/CreateInvoiceModal.tsx#L450-L454):
    ```tsx
    <option value="0">0% (Nil)</option>
    <option value="5">5% (Tiffin / Food)</option>
    <option value="12">12% (Accommodation)</option>
    <option value="18">18% (Standard Services)</option>
    ```
- **Task 01B.59 Audit Report Text:**
  - Task 01B.59 summarized GST support as: *"GST (0%, 5%, 12%) vs Non-GST regular bills"*, inadvertently omitting `18%`.

### 3.2 Tax Calculation & Rounding Analysis
1. **Intrastate vs Interstate Logic:**
   - Evaluated by comparing `companyStateCode.trim() === recipientStateCode.trim()`.
   - **Intrastate (e.g. Haryana 06 to Haryana 06):**
     - $\text{CGST Rate} = \text{Tax Rate} / 2$
     - $\text{SGST Rate} = \text{Tax Rate} / 2$
     - $\text{IGST Rate} = 0$
     - $\text{CGST Amount} = \text{Math.round}((\text{Amount} \times \text{CGST Rate}) / 100)$
     - $\text{SGST Amount} = \text{Math.round}((\text{Amount} \times \text{SGST Rate}) / 100)$
   - **Interstate (e.g. Haryana 06 to Delhi 07):**
     - $\text{CGST Amount} = 0$, $\text{SGST Amount} = 0$
     - $\text{IGST Amount} = \text{Math.round}((\text{Amount} \times \text{Tax Rate}) / 100)$
2. **Rounding Behavior:**
   - Rounding uses `Math.round()` at the line-item level. All database storage fields (`subtotal`, `cgst_amount`, `sgst_amount`, `igst_amount`, `total_tax`, `total_amount`) are integer INR.
   - For odd rates (5%) on odd numbers (e.g., ₹101 item at 5% intrastate: CGST 2.5% = ₹2.525 $\rightarrow$ ₹3; SGST 2.5% = ₹2.525 $\rightarrow$ ₹3; Total tax = ₹6, or 5.94%). For standard commercial pricing (whole hundreds/thousands), rounding matches standard accounting.

### 3.3 GSTIN Validation Findings
- **Company GSTIN:** If `invoiceType === "GST_TAX_INVOICE"`, [`invoiceService.ts:323-328`](file:///apps/erp/src/server/finance/invoiceService.ts#L323-L328) throws if `ERP_COMPANY_GSTIN` is absent or empty. However, it does **not** validate GSTIN format via regex (e.g., `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`).
- **Recipient GSTIN:** Accepted as an arbitrary optional string without syntax or checksum verification.

---

## 4. Prioritized Launch Blockers & Objective Acceptance Criteria

### Blocker 1: Backdated Transaction Insertion on Finalized Closing Dates (P1 - Financial Integrity)
- **Defect Description:** While [`cashbookClosingService.ts:432`](file:///apps/erp/src/server/finance/cashbookClosingService.ts#L432) rejects recalculating or updating an existing finalized daily closing record, [`financeService.ts`](file:///apps/erp/src/server/finance/financeService.ts) (`recordPayment`, `recordExpense`, `recordRentCharge`) does NOT query `daily_cashbook_closings` to check whether the transaction date falls on a closed business day. A user can record a transaction with a backdated date (e.g., yesterday or last week after close), which silently modifies the financial ledger while leaving the historical daily closing snapshot unchanged.
- **Objective Acceptance Criteria for Resolution:**
  1. Add a transaction validation guard `ensureDateNotFinalized(transactionDate, division, tx)` in `financeService.ts`.
  2. Attempting to record any payment, expense, charge, or reversal on a date where `daily_cashbook_closings.status = 'FINALIZED'` must be rejected with HTTP 422 (`"Date ${transactionDate} is closed and locked. Reopen the daily closing first."`).
  3. Automated regression tests must verify that backdated transactions on closed dates are strictly blocked.

### Blocker 2: Cashbook Summary Over-Reporting on Deposit Applications (P1 - Financial Integrity)
- **Defect Description:** In [`financeService.ts:868`](file:///apps/erp/src/server/finance/financeService.ts#L868), `getCashbookSummary` computes:
  ```sql
  COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as rentCollected
  ```
  When a resident checks out and their security deposit is applied against outstanding rent, [`residentSettlementService.ts:325`](file:///apps/erp/src/server/residents/residentSettlementService.ts#L325) records a `RENT_PAYMENT` with `category = 'DEPOSIT_APPLICATION'`. Because `financeService.ts` does not exclude `category = 'DEPOSIT_APPLICATION'`, `rentCollected` and `netCashMovement` include this non-cash accounting offset, falsely reporting it as cash received.
- **Objective Acceptance Criteria for Resolution:**
  1. Modify [`financeService.ts:868`](file:///apps/erp/src/server/finance/financeService.ts#L868) to `CASE WHEN transaction_type = 'RENT_PAYMENT' AND category != 'DEPOSIT_APPLICATION' AND status = 'POSTED' THEN amount ELSE 0 END`.
  2. Verify that `getCashbookSummary` net cash movement exactly equals `cashbookClosingService` expected cash movement for identical date ranges.

### Blocker 3: Persistent Document Volume Mounting (P1 - Operational Infrastructure)
- **Defect Description:** KYC documents and expense receipts are stored on local disk via [`documentStorageService.ts`](file:///apps/erp/src/server/documents/documentStorageService.ts). In a stateless containerized production deployment, redeployments or container restarts will wipe the local storage directory, permanently orphaning database records and destroying resident KYC files.
- **Objective Acceptance Criteria for Resolution:**
  1. Deployment configuration must explicitly map `ERP_STORAGE_DIR` to a persistent mounted volume (e.g., EBS volume, EFS share, or persistent cloud disk).
  2. Deployment smoke test must prove file survival across container container kill and restart.

---

## 5. Separate Launch Checklists: Controlled Pilot vs Full Production

### 5.1 Controlled Pilot Launch Checklist (Gated)
A controlled pilot with trusted internal property staff (manager, head cook, 1 front desk user, 1 delivery courier) is permissible once the following conditions are satisfied:

- [ ] **Operational Agreement on Daily Closing:** Staff instructed that daily closing must only occur at end-of-day after all transactions are entered, and backdated edits are strictly prohibited via administrative policy until Blocker 1 code fix is deployed.
- [ ] **Document Storage Volume:** Verify that `ERP_STORAGE_DIR` points to a persistent mounted disk directory on the host server.
- [ ] **Production Database Provisioning:** Ensure Neon PostgreSQL instance is active with SSL enabled (`sslmode=require`) and run migrations `0000` through `0011`.
- [ ] **SMTP Credentials Configured:** Set `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_HOST`, and `SMTP_PORT` with verified outbound delivery for login OTPs.
- [ ] **Super Admin Initial Credentials:** Configure `ERP_ADMIN_PASSWORD` (min 12 characters, non-demo) in production environment before first boot.
- [ ] **Room M01 Physical Walkthrough:** Property manager confirms bed layout with property owner (toggling `pending_owner_confirmation = 0` if 2 commercial beds).
- [ ] **Initial Kitchen Staples Count:** Perform physical baseline count of Atta, Rice, Dal, Oil, and Commercial 19kg LPG cylinders in stock.

### 5.2 Full Production Launch Checklist (Hard Gate)
Full unrestricted commercial operation across all external customers, corporate tiffin subscriptions, and automated online billing requires:

- [ ] **Resolve Blocker 1:** Code enforcement blocking backdated transactions on finalized daily closing dates in `financeService.ts`.
- [ ] **Resolve Blocker 2:** Exclude `category = 'DEPOSIT_APPLICATION'` from `financeService.ts:getCashbookSummary` to eliminate cashbook inflation.
- [ ] **Doorstep UPI Inflow Integration:** Implement automated or guided financial transaction creation for doorstep UPI delivery collections.
- [ ] **Strict GSTIN Format Validation:** Implement statutory 15-character regex and state code matching validation for GST invoices in `invoiceService.ts`.
- [ ] **Disaster Recovery & Backup Restoration Test:** Create and execute an automated database dump and restore drill with documented recovery time objective (RTO < 1 hour).
- [ ] **Shared Device Queue Auto-Purge:** Add automatic `offlineQueue.clearQueue()` call on driver logout in `DriverRunView.tsx`.
- [ ] **PostgreSQL Live Concurrency Drill:** Run automated integration tests with 50+ concurrent requests against a live PostgreSQL staging database with connection pooling enabled.

---

## 6. Exact Inspections Performed & Commands Executed

### 6.1 Safety Verification Inspections
1. **Primary Database Safety Check:**
   - Command: `Get-Item -Path "data/erp.db" | Select-Object FullName, Length, LastWriteTime`
   - Result: File size `1,388,544 bytes`, timestamp `21-10-2026 13:33:43` (Strictly untouched).
2. **Neon Rehearsal Database Isolation:**
   - Inspected test files and environment configs. Zero network calls or credentials dispatched to `ravi-narayana-erp-phase01b-test`.
3. **Git Working Tree Check:**
   - Command: `git status --short`
   - Result: Preserved all uncommitted files from Tasks 01B.37–01B.59. Zero commits, stashes, resets, or rebases.

### 6.2 Code & Architecture Inspections Performed
1. **GST Implementation Inspection:**
   - Inspected `apps/erp/src/server/finance/invoiceService.ts` (lines 55–160, 315–420).
   - Inspected `apps/erp/src/modules/finance/components/modals/CreateInvoiceModal.tsx` (lines 100–130, 440–470).
   - Inspected `tests/invoicing.test.ts` (lines 250–385).
2. **Financial Invariants & Deposit Accounting:**
   - Inspected `apps/erp/src/server/residents/residentSettlementService.ts` (lines 315–365).
   - Inspected `apps/erp/src/server/finance/financeService.ts` (lines 860–970).
   - Inspected `apps/erp/src/server/finance/cashbookClosingService.ts` (lines 135–175, 420–445, 780–840).
   - Inspected `tests/task01b_52_settlement.test.ts` (lines 850–885).
3. **Delivery Custody & Doorstep Collections:**
   - Inspected `apps/erp/src/server/delivery/deliveryService.ts` (lines 1570–1650, 1800–1880).
   - Inspected `tests/task01b_58_delivery_handover.test.ts`.
4. **Session Security & Secrets:**
   - Inspected `apps/erp/src/server/authentication/auth.ts` (lines 306–380).
   - Inspected `apps/erp/src/server/database/env.ts` (lines 1–116).
5. **Database Migration Inventory:**
   - Inspected `apps/erp/src/server/database/drizzle/meta/_journal.json` (12 migrations, index 0 to 11).
   - Inspected `tests/helpers/sqliteMigrations.ts` (20 SQLite migrations, V1 to V20).
6. **Logging & Audit Trail:**
   - Inspected `apps/erp/src/server/audit/audit.ts` (lines 1–80).
   - Inspected `package.json` dependencies (zero third-party APM or logging libraries).

### 6.3 Skipped Checks & Justifications
- **Live Neon PostgreSQL Migration / Execution:** Skipped because executing migrations or queries against a remote database without explicit user staging credentials violates safety constraints.
- **Live SMTP Transmission Test:** Skipped because initiating live external SMTP network socket connections could trigger spam filters or expose credentials in transit.
- **Physical Room M01 Inspection:** Skipped because physical architectural walkthrough cannot be performed from software codebase.

---

## 7. Facts That Could Not Be Independently Verified

1. **Physical Bed Count in Room M01:** Cannot be verified from repository. `M01` is marked `pending_owner_confirmation = 1` with provisional capacity 2. Only an in-person site visit can establish whether `M01` has 1 bed, 2 beds, or is owner-reserved.
2. **Third-Party SMTP Provider Throughput:** The code implements exponential retry and connection pooling for Nodemailer, but actual delivery speed and latency under Indian telecom/ISP networks cannot be measured without live testing.
3. **Neon PostgreSQL Pooler Behavior Under Peak Load:** Code uses `FOR UPDATE` on PostgreSQL transactions for invoice numbers and stay locks. However, connection starvation or pooler exhaustion under concurrent load on Neon free/shared tiers cannot be validated in local SQLite test runs.
4. **Container Host Mount Persistence:** Software correctly resolves `ERP_STORAGE_DIR`, but whether the hosting infrastructure actually configures persistent volume mounts cannot be verified from the Git repository alone.
