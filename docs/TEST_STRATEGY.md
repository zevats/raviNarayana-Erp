# Ravinarayan ERP — Master Test Strategy & Quality Assurance Framework

**Document Reference:** `docs/TEST_STRATEGY.md`  
**Status:** Authoritative Quality Assurance Plan (Phase 00 Baseline)  
**Date of Audit:** 16 October 2026  
**Active Test Harness:** Custom TypeScript Test Suite with Node Path Aliasing (`tests/`)  
**Verified Baseline:** 464 Automated Assertions Passed Across 7 Suites (0 Failures)  

---

## 1. Quality Assurance Philosophy & Testing Pyramid

The testing strategy prioritizes strict verification of financial invariants, concurrency guards, server-side RBAC enforcement, and data integrity over fragile cosmetic UI snapshots.

```text
                  ▲
                 / \
                /   \     E2E Lifecycle & Disaster Recovery Drills (5%)
               / E2E \    Cross-module 16-step integration & backup restore
              /───────\
             /         \   Integration & API Authorization Tests (35%)
            /  API/RBAC \  All 30 REST routes, 5 roles, 401/403 responses
           /─────────────\
          /               \ Unit Tests & Domain Invariants (60%)
         /   Unit / Rules  \ Pure business logic: room capacity, idempotency,
        /───────────────────\ cashbook formulas, rate limits, CSV sanitization
```

---

## 2. Existing Test Suite Inventory & Baseline Results

All 7 test suites execute sequentially via `npm test`:

```bash
npm run test:security && npm run test:rbac && npm run test:rooms && npm run test:finance && npm run test:kitchen && npm run test:integration && npm run test:delivery
```

| Suite Name | Source File | Assertions Passed | Primary Focus & Verified Invariants |
| :--- | :--- | :---: | :--- |
| **Security Hardening** | `tests/auth_hardening.test.ts` | **49 / 49** | Password verification, token hashing at rest (SHA-256), 3-layer rate limiting (IP, Pair, Velocity), constant-time dummy verify. |
| **Staff & RBAC Foundation** | `tests/rbac_staff_foundation.test.ts` | **28 / 28** | 5 discrete roles, least-privilege matrix, sole super-admin protection, deactivation session cleanup, credential sanitization in audit logs. |
| **Rooms & Residents** | `tests/rooms_residents.test.ts` | **60 / 60** | Bed capacity limits, overbooking prevention, partial unique index (1 active stay/resident), instant bed release on checkout, case-insensitive room uniqueness (`NOCASE`). |
| **Finance & Cashbook** | `tests/finance.test.ts` | **102 / 102** | Rent charges, payments, anti-overpayment guard, security deposit custodial isolation, expenses, cashbook net cash movement, cross-period reversals, idempotency key mismatch rejection, CSV formula injection escaping. |
| **Kitchen Operations** | `tests/kitchen.test.ts` | **62 / 62** | Resident meal eligibility, opt-out deduction, attendance records, unique meal constraints, justified manual adjustments, prep sheet totals, check-out historical preservation. |
| **Tiffin Delivery & Handover**| `tests/delivery.test.ts` | **137 / 137** | Decoupled delivery tasks, courier assignment validation, strict courier ownership isolation, valid status transitions, mandatory failure reasons, authorized retries, non-interference with finance ledger, notification read tracking. |
| **Monorepo Integration** | `tests/integration_audit.test.ts`| **26 / 26** | Full 16-step cross-module operational lifecycle from check-in to billing, meal prep, delivery, payment, reversal, and audit trail verification. |
| **TOTAL VERIFIED BASELINE** | **7 Test Suites** | **464 / 464 PASSED** | **Zero Failures. 100% Invariant Pass Rate.** |

---

## 3. High-Priority Test Scenarios & Invariant Verification

### 3.1 Concurrency & Race Condition Scenarios
1. **Concurrent Bed Check-In Race:**
   - *Scenario:* Two staff members attempt to assign two different residents to the last remaining bed in Room 103 simultaneously.
   - *Expected Behavior:* In PostgreSQL, the row lock (`SELECT ... FOR UPDATE`) serializes the transactions. Exactly one check-in succeeds; the second request throws `Room is at full capacity` (HTTP 409).
2. **Duplicate Payment Submission (Double-Click / Network Retry):**
   - *Scenario:* A staff member double-clicks "Record Payment" or a mobile device retries a POST request with the same `idempotency_key`.
   - *Expected Behavior:* The second request returns the existing posted transaction record without creating a duplicate debit/credit entry or altering cashbook balances.
3. **Idempotency Payload Mismatch:**
   - *Scenario:* An attacker reuses an existing `idempotency_key` with a different amount or resident ID.
   - *Expected Behavior:* The server detects the payload discrepancy and strictly rejects with an error message: *"Idempotency key was already used with a different transaction payload."*

### 3.2 Authorization & Object-Level Isolation Scenarios
1. **Delivery Staff Financial Privilege Escalation:**
   - *Scenario:* A `DELIVERY_PERSON` makes a direct API call to `POST /api/finance/transactions` or `GET /api/finance/cashbook`.
   - *Expected Behavior:* Fails closed with HTTP 403 `FORBIDDEN` and logs an `auth.forbidden` security event.
2. **Courier Task Ownership Hijacking:**
   - *Scenario:* Courier A attempts to dispatch, complete, or inspect tasks assigned to Courier B.
   - *Expected Behavior:* The server returns HTTP 403 `FORBIDDEN`. Couriers can only view and update tasks matching their own `staff_id`.
3. **Sole Super Administrator Protection:**
   - *Scenario:* An administrator attempts to demote or deactivate the only active `SUPER_ADMIN` account.
   - *Expected Behavior:* Rejected with error: *"Cannot deactivate the sole active Super Administrator."*

### 3.3 Financial Invariant Scenarios
1. **Anti-Overpayment Guard:**
   - *Scenario:* Resident owes ₹8,500. Staff attempts to record a rent payment of ₹10,000 without allocating to deposit.
   - *Expected Behavior:* Rejected with error: *"Payment amount exceeds outstanding rent balance."*
2. **Paid Rent Charge Reversal Prevention:**
   - *Scenario:* Staff attempts to reverse a ₹10,000 rent charge after payments have already been applied against it.
   - *Expected Behavior:* Rejected with error: *"Cannot reverse rent charge because payments have already been applied. Reverse payments first."*
3. **Reversal Inversion Guard:**
   - *Scenario:* Staff attempts to reverse a `REVERSAL` transaction.
   - *Expected Behavior:* Rejected with error: *"Reversal records cannot themselves be reversed."*

---

## 4. Responsive UI & Cross-Device Test Specifications

Automated headless Chrome CDP verification tests all 5 target viewports against the live ERP:

| Target Viewport | Screen Dimensions | Emulated Device Class | Pass Criteria |
| :--- | :---: | :--- | :--- |
| **Desktop High-Res** | $1440 \times 900$ | Desktop / Monitor | 0px document overflow; 5 summary cards in 1 row; full ₹ amounts visible. |
| **Standard Laptop** | $1280 \times 800$ | Laptop Display | Action buttons wrap without clipping; full ₹ amounts visible; 0px overflow. |
| **Compact Desktop** | $1024 \times 768$ | iPad Pro / Small Screen | Summary cards reflow to $3 + 2$; action buttons wrap cleanly; 0px overflow. |
| **Tablet Portrait** | $768 \times 1024$ | iPad / Tablet | Sidebar collapses to toggle; cards reflow to 2 cols; table scrolls internally. |
| **Mobile Portrait** | $390 \times 844$ | iPhone 14 / Android Phone | Cards stack into 1 col; thumb-friendly tap targets ($\ge 44$px); 0px overflow. |

---

## 5. PostgreSQL Test Harness Expansion Plan (Phase 01)

When migrating persistence to PostgreSQL in Phase 01:
1. **Test Database Isolation:** Run tests against a local Dockerized PostgreSQL instance (`postgresql://postgres:postgres@localhost:5433/ravinarayan_test`) or isolated test schema.
2. **Transaction Rollback Per Test:** Each integration test executes inside an isolated transaction that rolls back upon completion, guaranteeing zero state leakage between tests.
3. **Data Wipe Safeguard:** The test harness must assert `NODE_ENV === 'test'` and verify that the target database name contains `_test`. It must strictly refuse execution if pointed at a production connection string.
