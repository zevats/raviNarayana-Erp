# TASK 01B.50 — Critical Kitchen Demand & Inventory Concurrency Fixes Remediation Report
**Ravi Narayana PG & Commercial Tiffin ERP**  
**Remediation Date:** 2026-10-22  
**Role:** Senior Engineer & Cross-Module Integrator  
**Status:** Complete & Fully Verified  

---

## 1. Executive Summary

Task 01B.50 implemented minimal, focused, and robust remediations for the two critical high-impact defects identified in `TASK_01B_49_INTEGRITY_AUDIT.md`:

1. **`AUDIT-DEFECT-01` (Tiffin Demand Eligibility):** Inactive Tiffin customers or products were able to continue generating daily kitchen demand and delivery dispatch tasks.
2. **`AUDIT-DEFECT-02` (Atomic Inventory Consumption):** Concurrent kitchen production confirmations could pass an application-level pre-check and oversubscribe raw material inventory, driving stock below zero.

Both issues have been remediated in the application core without altering existing schemas, breaking historical records, or modifying unrelated modules. All existing work from Tasks 01B.37 through 01B.49 has been strictly preserved.

---

## 2. Root Cause Analysis & Fix Details

### Fix A: Tiffin Demand Eligibility (`AUDIT-DEFECT-01`)

- **Affected File:** [`apps/erp/src/server/kitchen/kitchenService.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/kitchen/kitchenService.ts#L248-L255)
- **Function:** `getEligibleTiffinSubscriptionsForDate(actor, serviceDate, mealType, asyncDb)`
- **Root Cause:**
  The query in `getEligibleTiffinSubscriptionsForDate` joined `tiffin_subscriptions s`, `tiffin_customers c`, and `tiffin_products p`, but only filtered on `s.start_date <= ? AND (s.end_date IS NULL OR s.end_date >= ?) AND (s.status != 'CANCELLED' ...)`.
  - It omitted `c.status = 'ACTIVE'`: If a customer was deactivated (`status = 'INACTIVE'`), their subscriptions were still included in daily meal planning.
  - It omitted `p.status = 'ACTIVE'`: If a product package was deactivated or discontinued, its subscriptions still generated demand.
  - It permitted non-active subscriptions (e.g. `COMPLETED` or `PAUSED` without date bounds) to leak into demand calculations.
- **Implemented Fix:**
  Updated the query predicates to explicitly require:
  ```sql
  WHERE s.status = 'ACTIVE'
    AND c.status = 'ACTIVE'
    AND p.status = 'ACTIVE'
    AND s.start_date <= ?
    AND (s.end_date IS NULL OR s.end_date >= ?)
  ```
  Parameters reduced from 3 to 2: `[cleanDate, cleanDate]`.
- **System-Wide Consistency:**
  `getEligibleTiffinSubscriptionsForDate` is the authoritative single source of truth for:
  1. `calculateDailyKitchenDemand` (daily forecast and portion calculation)
  2. `createMealPlan` (initial planned tiffin count)
  3. `refreshMealPlanDemand` (re-syncing demand before production)
  4. `getMealPlanDetail` / prep sheet summaries
  5. `generateDeliveryTasks` in `deliveryService.ts` (generating commercial delivery tasks)
  All downstream workflows now uniformly exclude inactive accounts and products without introducing conflicting logic.
- **Historical Data Preservation:**
  Existing historical meal plans, completed delivery tasks, invoices, and resident attendance records are left untouched in the database.

---

### Fix B: Atomic Inventory Consumption (`AUDIT-DEFECT-02`)

- **Affected File:** [`apps/erp/src/server/kitchen/kitchenInventoryService.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/kitchen/kitchenInventoryService.ts#L1580-L1650)
- **Function:** `confirmProductionConsumption(actor, planId, clientIp, providedDb)`
- **Root Cause:**
  `confirmProductionConsumption` previously performed a check-then-act pattern:
  1. It queried `current_stock` for each ingredient outside the transaction.
  2. If sufficient, it opened a database transaction and executed an unconditional `UPDATE kitchen_raw_materials SET current_stock = current_stock - ?`.
  Under concurrent execution (e.g. two kitchen managers confirming separate meal batches at peak hour), both transactions could pass the pre-check and decrement stock, driving `current_stock` into negative balances or double-consuming raw material portions.
- **Implemented Fix:**
  Replaced the unsafe check-then-act logic with a multi-layered atomic transaction strategy:
  1. **Idempotency Under Lock:** Re-verifies `getProductionConsumptionForPlan(actor, planId, tx)` inside the transaction. If another concurrent request for the same plan already posted consumption, it returns the existing record immediately without duplicating deductions.
  2. **Canonical Deadlock Prevention Sort:** Ingredients are sorted canonically by `materialId` (`sortedDeductions = [...deductions].sort((a, b) => a.materialId.localeCompare(b.materialId))`) before acquiring row-level locks, eliminating lock-ordering deadlocks in concurrent PostgreSQL transactions.
  3. **Atomic Conditional Decrement:** Replaced unconditional update with a condition enforced at the moment of the write:
     ```sql
     UPDATE kitchen_raw_materials
     SET current_stock = current_stock - ?, updated_at = ?
     WHERE id = ? AND current_stock >= ?
     ```
  4. **Affected-Row Assertion & Informative Rollback:** Checks `updateRes.changes === 0`. If 0 rows were updated, stock was insufficient at the exact write timestamp. The service queries fresh row state and throws an `InsufficientStockError` with full shortage metadata, triggering an immediate and clean transaction rollback (`ROLLBACK`).
  5. **All-or-Nothing Unit of Work:** The consumption header insert (`kitchen_production_consumptions`), stock movements (`kitchen_stock_movements`), and raw material updates commit or roll back as one single atomic unit. If a later ingredient fails, all earlier deductions are automatically undone.

---

## 3. Transaction & Concurrency Strategy Across Database Engines

| Concern | PostgreSQL (Neon AWS Singapore - Production) | SQLite (Offline Isolated Test Runner) |
|:---|:---|:---|
| **Write Atomicity** | Atomic `UPDATE ... WHERE id = ? AND current_stock >= ?` executed inside `sqlClient.begin(async (sqlTx) => ...)` | Atomic `UPDATE ... WHERE id = ? AND current_stock >= ?` executed inside `BEGIN IMMEDIATE ... COMMIT / ROLLBACK` |
| **Row Locking & Contention** | PostgreSQL acquires exclusive row-level write locks on the updated `kitchen_raw_materials` rows. Concurrent transactions wait for the lock and re-evaluate the `current_stock >= ?` predicate against the committed version. | SQLite `BEGIN IMMEDIATE` acquires a reserved write lock on the database file, serializing concurrent writes without race hazards. |
| **Deadlock Prevention** | Canonical sorting of ingredient IDs (`a.materialId.localeCompare(b.materialId)`) guarantees all concurrent transactions acquire row locks in identical alphabetical order, eliminating graph deadlocks. | Consistent ordering preserves sequential determinism. |
| **Affected Row Detection** | Evaluates `res.count` from `postgres.js`. If count is 0, throws error and triggers `ROLLBACK`. | Evaluates `info.changes` from `better-sqlite3`. If 0, throws error and triggers `ROLLBACK`. |
| **Non-Negative Guarantee** | Stock balances are mathematically guaranteed to satisfy `current_stock >= 0`. | Same guarantee enforced. |

---

## 4. Files Changed

| File Path | Nature of Change | Purpose |
|:---|:---:|:---|
| `apps/erp/src/server/kitchen/kitchenService.ts` | Modified (lines 248–255) | Enforce `s.status = 'ACTIVE' AND c.status = 'ACTIVE' AND p.status = 'ACTIVE'` in `getEligibleTiffinSubscriptionsForDate`. |
| `apps/erp/src/server/kitchen/kitchenInventoryService.ts` | Modified (lines 1581–1655) | Enforce atomic conditional decrements (`current_stock >= ?`), row changes assertion, canonical deadlock sorting, and inside-transaction idempotency in `confirmProductionConsumption`. |
| `tests/task01b_50_remediation.test.ts` | New file (360 lines) | 39 test assertions covering all required cases for Fix A and Fix B against an isolated test database. |
| `package.json` | Modified (lines 34, 37) | Registered `test:task50` script and added to master monorepo test suite `npm test`. |

---

## 5. Test Commands & Empirical Results

### 5.1 Targeted Remediation Tests (`npm run test:task50`)
Executed 4 comprehensive test suites:
- **Suite 1:** Database Migration V16 & Seed Verification.
- **Suite 2 (Fix A):** Active subscription demand (3 portions); CANCELLED and PAUSED excluded; inactive customer excluded; inactive product excluded; meal type filtering (Breakfast vs Lunch); resident demand unaffected (1 resident + 3 tiffin = 4 total); dynamic status deactivation immediate effect; demand refresh count update without resident record duplication.
- **Suite 3 (Fix B):** Insufficient stock on Paneer rejects confirmation and preserves Atta stock at 1,500g (atomic rollback); concurrent execution of Plan A (1,000g) and Plan B (1,000g) against 1,500g stock results in exactly 1 fulfilled and 1 rejected; non-negative stock invariant guaranteed (final stock: 500g); repeated confirmation remains idempotent; reversal restores exact stock (+1,000g -> 1,500g) and creates compensating movements.
- **Suite 4:** Primary protected database guard and clean environment teardown.

**Targeted Test Results:** **39 PASSED, 0 FAILED**.

### 5.2 Kitchen & Inventory Regression Suites
- `npm run test:kitchen`: **153 PASSED, 0 FAILED**.
- `npm run test:kitchen_inventory`: **91 PASSED, 0 FAILED**.

### 5.3 Monorepo Test Suite (`npm test`)
All 13 test suites passed:
- `test:security`: 49 passed
- `test:rbac`: 62 passed
- `test:rooms`: 69 passed
- `test:finance`: 120 passed
- `test:invoicing`: 68 passed
- `test:kitchen`: 153 passed
- `test:integration`: 46 passed
- `test:delivery`: 171 passed
- `test:otp`: 61 passed
- `test:perf`: 36 passed
- `test:tiffin`: 258 passed
- `test:kitchen_inventory`: 91 passed
- `test:task50`: 39 passed

**Total Monorepo Tests:** **1,223 PASSED, 0 FAILED** (100% pass rate).

### 5.4 TypeScript Type Check
- `npx tsc -p apps/erp/tsconfig.json --noEmit`: **0 errors**.

---

## 6. Remaining Limitations & Boundary Notes

1. **Prepaid Delivery Exception Credits (`AUDIT-DEFECT-03`):** Unbilled failed deliveries on fixed prepaid subscriptions currently require manual adjustment by accounting staff. This is an operational enhancement reserved for Task 01B.51.
2. **Payment Method UI Normalization (`AUDIT-DEFECT-04`):** Financial aggregation and cashbook accounting calculate numbers accurately, but legacy UI dropdown casing remains scheduled for cleanup in Task 01B.51.

---

## 7. Absolute Data-Protection Statement

- **Primary Protected Database (`data/erp.db`):** Zero reads, zero writes, zero file touches. File size and timestamps are identical to pre-task state.
- **Rehearsal Database (`ravi-narayana-erp-phase01b-test`):** Never connected to or modified.
- **Active Development Database (`neondb` on AWS Singapore):** Preserved intact without destructive schema resets.
- **Git Safety:** Zero commits, zero pushes, zero deployments, zero stashes or branch resets executed.
