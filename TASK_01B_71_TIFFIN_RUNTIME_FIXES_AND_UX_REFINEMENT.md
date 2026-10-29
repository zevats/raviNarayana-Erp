# Task 01B.71 — Tiffin Runtime Error Fixes, Practical Order Entry & Delivery UX Refinement

**Repository:** `zevats/raviNarayana-Erp`  
**Branch:** `master`  
**Evaluation Date:** 24 October 2026  
**Status:** `Completed & Fully Verified | 100% Tests Passing | Production Build Clean`

---

## 1. Executive Summary

Task 01B.71 resolves critical runtime database errors, internal marker leakage, and user experience friction points discovered during real-world testing of the two-page Orders and Delivery redesign from Task 01B.70.

The two-page model (`/orders` and `/delivery`) remains the foundation of commercial operations. All changes preserve existing architecture, uncommitted work from Tasks 01B.37 through 01B.70, and strict zero-touch database immutability guards for `data/erp.db` and the protected rehearsal database `ravi-narayana-erp-phase01b-test`.

---

## 2. Root Cause Analysis & Technical Resolutions

### 2.1 Critical Backend Error A: `column "collection_idempotency_key" does not exist`
- **Symptom:** Submitting delivery completion on `/delivery` threw HTTP 400 with `column "collection_idempotency_key" of relation "delivery_tasks" does not exist`.
- **Root Cause:** Drizzle migration `0011_delivery_handover.sql` added `collection_idempotency_key`, `collection_status`, `collected_amount`, `collected_payment_method`, `collection_transaction_id`, and `handover_id` to table `delivery_tasks`. While the migration file existed in source control, it had not been applied to the live PostgreSQL database (`neondb`).
- **Resolution:**
  - Applied pending migrations `0006` through `0011` to `neondb`. Verified that all 34 database tables and all columns (including `collection_idempotency_key`) exist in the runtime PostgreSQL schema.
  - Authored [`scripts/migrate.js`](file:///scripts/migrate.js) with explicit protection against mutating rehearsal databases.
  - Added `"db:migrate": "node scripts/migrate.js"` in root `package.json`.
  - Updated [`scripts/start-erp.ps1`](file:///scripts/start-erp.ps1) to run migrations automatically prior to starting the Next.js development server.

### 2.2 Critical Backend Error B: `relation "daily_cashbook_closings" does not exist`
- **Symptom:** Opening the order modal or recording a walk-in counter sale failed with `relation "daily_cashbook_closings" does not exist`.
- **Root Cause:** Drizzle migration `0009_daily_cashbook_closing.sql` defines `daily_cashbook_closings`. Because migrations 0006–0011 had not been executed on `neondb`, the closing lock check in `assertClosingDateNotFinalized` failed at runtime.
- **Resolution:**
  - Applied migration 0009 to `neondb`. Table `daily_cashbook_closings` is now present in PostgreSQL with full indexes and constraints.
  - Both Dine-in counter sales (`TIFFIN_WALKIN_SALE`) and delivery order flows execute without missing-table errors.

### 2.3 Raw `[ORDER_JSON:...]` Internal Marker Leakage Eradication
- **Symptom:** Operational cards on `/delivery` displayed internal system JSON markers in the notes line (e.g. `Note: [ORDER_JSON:{"orderType":"DELIVERY","items":[...],"totalAmount":150}] Please call at door`).
- **Root Cause:** Structured metadata was embedded in `delivery_tasks.delivery_notes` using the format `[ORDER_JSON:{...}] <notes>`. The delivery view rendered `task.deliveryNotes` directly without stripping the system prefix.
- **Resolution:**
  - Implemented `extractCleanUserNotes(notes)` in [`apps/erp/src/server/delivery/deliveryService.ts`](file:///apps/erp/src/server/delivery/deliveryService.ts) using balanced brace-depth parsing to strip `[ORDER_JSON:{...}]` while preserving genuine human notes. If only the marker is present, it returns `null`.
  - Added `items?: OrderItem[];` to `DeliveryTask` in [`apps/erp/src/types/index.ts`](file:///apps/erp/src/types/index.ts).
  - Updated `mapRowToDeliveryTask` in `deliveryService.ts` to parse items from structured metadata and assign clean notes to `deliveryNotes`.
  - In `completeDeliveryTask`, preserved the raw `[ORDER_JSON:...]` prefix in the underlying database column while sanitizing the returned task object.
  - In [`apps/erp/src/app/(management)/delivery/page.tsx`](file:///apps/erp/src/app/(management)/delivery/page.tsx), rendered ordered items as discrete badges (`1x Deluxe Thali`) and rendered `Note: ...` only when genuine human notes exist.

### 2.4 Removal of Manual "Start Transit" Step
- **Symptom:** New delivery orders required an operator to manually click "Start Transit" before the order could be delivered.
- **Root Cause:** `createUnifiedOrder` assigned the task to Suresh but left the task in `ASSIGNED` status ("Ready for Run").
- **Resolution:**
  - In `createUnifiedOrder` ([`apps/erp/src/server/orders/orderService.ts`](file:///apps/erp/src/server/orders/orderService.ts)), immediately invoked `dispatchDeliveryTask(actor, extTask.id, clientIp, db)` after assigning to Suresh.
  - Delivery orders transition directly to `OUT_FOR_DELIVERY` upon creation, immediately appearing on Suresh's active run.
  - Removed the manual "Start Transit" button from [`apps/erp/src/app/(management)/delivery/page.tsx`](file:///apps/erp/src/app/(management)/delivery/page.tsx).

### 2.5 Simplified Single-Screen Delivery Completion Modal
- **Symptom:** The previous modal had an "Enter Delivered" vs "Enter Undelivered" mode switcher toggle, causing confusion and input ambiguity on mobile screens.
- **Resolution in [`apps/erp/src/modules/delivery/components/modals/SingleScreenDeliveryModal.tsx`](file:///apps/erp/src/modules/delivery/components/modals/SingleScreenDeliveryModal.tsx):**
  - Removed the mode switcher buttons completely.
  - Implemented a unified, single-screen layout:
    1. Read-only ordered quantity display (`Ordered: X portions`).
    2. Single primary input: `Delivered Portions` stepper (`-`, number input, `+`).
    3. Auto-calculated read-only indicator: `Undelivered = Ordered - Delivered`.
    4. Mandatory shortfall reason (with quick chips and custom input) enforced whenever `Undelivered > 0`.
    5. Live expected collection calculation (`deliveredQuantity * unitPrice`), editable collected amount input, and CASH/UPI selection.

### 2.6 Simplified Fast Order Entry Modal
- **Resolution in [`apps/erp/src/modules/orders/components/NewOrderModal.tsx`](file:///apps/erp/src/modules/orders/components/NewOrderModal.tsx):**
  - Retained the two-page model (`/orders` and `/delivery`).
  - Removed redundant text (`"Auto-dispatched to Suresh"`).
  - Removed the payment method selector when `orderType === "DELIVERY"` (payment is collected at the doorstep).
  - Retained the payment method selector when `orderType === "DINE_IN"` (walk-in counter payment).
  - Compact menu rows with item name, category badge, unit price, quantity steppers, and line totals.

### 2.7 Duplicate Customer Prevention
- **Symptom:** Operators entering an existing customer's phone number under "New Customer" created duplicate customer records.
- **Resolution:**
  - **Client-Side:** In `NewOrderModal.tsx`, entering a phone number in "New Customer" triggers a debounced check against `/api/tiffin/customers`. If a matching customer is found, a prominent warning banner is displayed:
    - `"This phone number already exists"` with matching customer name and address.
    - Button 1: `"Use Existing Customer"` (switches to Existing mode, populates customer and past order history).
    - Button 2: `"Edit Phone Number"` (clears phone input for re-entry).
    - Blocks submission if duplicate phone is not resolved.
  - **Server-Side:** In `createUnifiedOrder` (`orderService.ts`), if `!input.customerId` and `customerPhone` matches an existing customer in `tiffin_customers`, the server strictly rejects the request with: `Customer with phone number '${customerPhone}' already exists ('${existingCustomer.full_name}'). Please select the existing customer or provide customerId.`

---

## 3. Automated Test Suite (`test:task71`)

A dedicated automated test suite was authored in [`tests/task01b_71_runtime_fixes_and_ux.test.ts`](file:///tests/task01b_71_runtime_fixes_and_ux.test.ts) and registered in `package.json` (`npm run test:task71`).

### Test Coverage Breakdown:
1. **Schema Integrity (Errors A & B Prevention):** Confirmed `daily_cashbook_closings` table and `delivery_tasks.collection_idempotency_key`, `collection_status`, and `collected_amount` columns exist.
2. **Automatic Assignment & Dispatch:** Verified delivery orders auto-assign to Suresh and transition immediately to `OUT_FOR_DELIVERY`.
3. **Notes Sanitation:** Verified `extractCleanUserNotes` strips `[ORDER_JSON:...]` even with nested structures, returns `null` for JSON-only notes, and preserves human instructions. Verified `task.items` parses into `OrderItem[]`.
4. **Single-Screen Delivery Completion:** Verified shortfall without reason is rejected; valid completion records `DELIVERED`, `COLLECTED`, and persists `collection_idempotency_key`. Verified idempotent repeat completion.
5. **Duplicate Customer Prevention:** Verified server-side rejection on duplicate phone; verified phone normalization (`+91 98765-00001` &rarr; `9876500001`).
6. **Dine-In Counter Orders & Closing Lock:** Verified dine-in walk-in sale completion, posting to `financial_transactions`, and closing lock enforcement on finalized dates.
7. **Fleet Summary & Webmanifest:** Verified `getFleetCustodySummary` returns valid aggregate metrics; verified `manifest.webmanifest` exists, is valid JSON, and has `display: standalone`.
8. **Primary DB Immutability:** Verified `data/erp.db` length (1,388,544 bytes) and modification time are 100% identical before and after test execution.

---

## 4. Verification Results Summary

| Test Suite / Build Check | Assertions / Routes | Result |
| :--- | :---: | :---: |
| `npm run test:task71` (Task 01B.71 Suite) | 46 assertions | **46 PASSED, 0 FAILED** |
| `npm run test:task70` (Two-Page Workflow Suite) | 67 assertions | **67 PASSED, 0 FAILED** |
| `npm run test:delivery` (Delivery Domain Suite) | 171 assertions | **171 PASSED, 0 FAILED** |
| `npm run test:task69` (Tiffin Operations Suite) | 46 assertions | **46 PASSED, 0 FAILED** |
| `npm run test:task58` (Delivery Handover & Sync Suite) | 84 assertions | **84 PASSED, 0 FAILED** |
| `npm run test:tiffin` (Tiffin Directory & Catalog Suite) | 258 assertions | **258 PASSED, 0 FAILED** |
| `npx tsc -p apps/erp/tsconfig.json --noEmit` | ERP App Types | **0 errors (100% type-safe)** |
| `npm run build:erp` (Next.js Production Build) | 18 static / 100+ dynamic | **Compiled successfully (Exit Code 0)** |
| Primary Database Immutability (`data/erp.db`) | 1,388,544 bytes | **100% Untouched (Pristine)** |

---

## 5. Modified Files Register

- [`package.json`](file:///package.json): Added `"db:migrate"` and `"test:task71"`.
- [`scripts/migrate.js`](file:///scripts/migrate.js): Automated migration runner with rehearsal safety guards.
- [`scripts/start-erp.ps1`](file:///scripts/start-erp.ps1): Integrated automatic migration check prior to dev server start.
- [`apps/erp/src/types/index.ts`](file:///apps/erp/src/types/index.ts): Added `items?: OrderItem[];` to `DeliveryTask`.
- [`apps/erp/src/server/delivery/deliveryService.ts`](file:///apps/erp/src/server/delivery/deliveryService.ts): Added `extractCleanUserNotes` and balanced bracket JSON extraction; sanitized notes mapping; preserved raw prefix in DB.
- [`apps/erp/src/server/orders/orderService.ts`](file:///apps/erp/src/server/orders/orderService.ts): Auto-dispatched delivery tasks to `OUT_FOR_DELIVERY`; enforced duplicate customer phone check; normalized phone numbers.
- [`apps/erp/src/app/(management)/delivery/page.tsx`](file:///apps/erp/src/app/(management)/delivery/page.tsx): Removed "Start Transit" button; sanitized note rendering; displayed ordered items badges.
- [`apps/erp/src/modules/delivery/components/modals/SingleScreenDeliveryModal.tsx`](file:///apps/erp/src/modules/delivery/components/modals/SingleScreenDeliveryModal.tsx): Removed mode switcher; unified Delivered Portions input with auto Undelivered calculation, mandatory shortfall reason, and collection persistence.
- [`apps/erp/src/modules/orders/components/NewOrderModal.tsx`](file:///apps/erp/src/modules/orders/components/NewOrderModal.tsx): Removed payment selector for delivery orders; removed redundant text; added real-time duplicate customer phone check and resolution banner.
- [`tests/task01b_71_runtime_fixes_and_ux.test.ts`](file:///tests/task01b_71_runtime_fixes_and_ux.test.ts): Comprehensive 46-assertion test suite.
- [`reasons.md`](file:///reasons.md): Documented Section 11 detailing root causes, technical resolutions, and verification evidence.
- [`FEATURE_FLOW_STATUS.md`](file:///FEATURE_FLOW_STATUS.md): Updated cumulative verification register (Tasks 01B.37–01B.71) and test matrix.
