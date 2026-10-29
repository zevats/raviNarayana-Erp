# Task 01B.67 — Mobile Role Workflows: Management & Finance Report

**Repository:** `zevats/raviNarayana-Erp`  
**Branch:** `master`  
**Status:** Implementation Complete & Production Build Verified  
**Date:** 2026-10-24T15:58:00+05:30  
**Lead Engineer:** Senior ERP Architect, Mobile PWA Specialist & Financial Systems Lead  

---

## 1. Executive Summary & Architecture

Task 01B.67 expands the mobile Progressive Web App (PWA) beyond delivery drivers to provide native-feeling, touch-optimized, role-aware mobile workflows for:
1. **Owner / Super Admin:** Executive mobile dashboard featuring real live KPIs (occupancy, rent collections, kitchen headcount, outstanding balances), 3-way business division filtering (Consolidated, PG Guesthouse, Tiffin Service), and quick touch action pills to primary operational destinations.
2. **Operations Manager:** Streamlined operational shortcuts for resident check-in, room transfers, live kitchen meal production, and delivery task dispatch. Bottom navigation prioritizes operational execution (`Dashboard`, `Residents`, `Kitchen`, `Delivery`, `More`).
3. **Accountant:** Mobile-first financial management featuring touch cards for cashbook entries and customer invoices, direct modal triggers for receipt generation and payment allocations, and responsive layout for daily closing reconciliation. Bottom navigation prioritizes fiscal control (`Dashboard`, `Finance`, `Residents`, `Tiffin`, `More`).

### Core Architectural Invariants:
- **Single Monolith, Role-Aware Experience:** Reuses the existing Next.js App Router, authenticated session tokens (`auth_token`), and server-authoritative RBAC without bifurcating backends or creating secondary ledgers.
- **Strict Separation of Online vs Offline Capabilities:** In adherence to core financial integrity principles, **no offline queueing exists for financial ledger mutations, cashbook closing, room checkout settlements, or invoice generation**. Only field delivery doorstep completion/exceptions are queued offline.
- **Doorstep UPI Collections Remain Unposted until Reconciliation:** Doorstep UPI payments recorded by drivers are stored as operational delivery collection metadata and **do not** automatically post to the financial cashbook ledger without bank verification, preserving cashbook accuracy.
- **Preservation of Desktop Density:** Desktop tables (`hidden md:block`) remain 100% pixel-dense and full-featured. Mobile viewports (`block md:hidden`) render vertical touch cards with prominent metadata badges, quick copy buttons, and direct action triggers.
- **Zero Fabricated Metrics:** Every metric on mobile dashboards and ledgers binds to authentic server queries.

---

## 2. Offline Queue Security & Account Isolation Prerequisites

Before expanding management workflows, the client and server offline delivery queue was hardened to eliminate security and concurrency vulnerabilities:

### 2.1 Payload Sanitization & Stripping of Sensitive Fields
In [`apps/erp/src/modules/delivery/offlineQueue.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/delivery/offlineQueue.ts):
- Implemented `sanitizePayload(action, rawPayload)`:
  - Whitelists **strictly** required operational fields for `COMPLETE_DELIVERY`: `recipientName`, `notes`, `collectedAmount`, `paymentMethod`.
  - Whitelists **strictly** required operational fields for `REPORT_EXCEPTION`: `exceptionType`, `reason`.
  - Discards all other keys, guaranteeing that session tokens (`token`, `sessionToken`), password hashes (`passwordHash`, `userPasswordHash`), KYC document references (`kycDocumentRef`), or arbitrary cookies injected into memory or client storage are stripped before persistence.

### 2.2 Account-Isolated Client Storage
- Tagged every `QueuedDeliveryAction` with `userId?: string`.
- Updated `getOfflineQueue(userId?: string)` to filter queued actions by the currently authenticated user's ID.
- Added `clearUserOfflineQueue(userId: string)` to purge only the active user's queued actions upon sign-out or manual clear, ensuring that Driver B using a shared smartphone cannot view, clear, or interfere with Driver A's pending actions in `localStorage`.

### 2.3 Server-Side Cross-Account Replay Protection
In [`apps/erp/src/server/delivery/deliveryService.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/delivery/deliveryService.ts) (`syncDeliveryActions`):
- Added validation comparing `action.userId` against `actor.id`.
- Rejects any synchronization request where `action.userId && action.userId !== actor.id` with status `CONFLICT` and an explicit security violation error:
  `"Security violation: Action was queued by a different authenticated account and cannot be synchronized under this session."`
- Guarantees that even if local storage is modified or replayed under a different session, cross-account contamination of task ownership or cash custody is blocked.

### 2.4 Auth Failure Detection & Infinite Loop Termination
In [`apps/erp/src/modules/delivery/offlineQueue.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/delivery/offlineQueue.ts) (`processOfflineQueue`):
- Detects HTTP 401 (Unauthorized) and HTTP 403 (Forbidden) server responses.
- Transitions affected queued items to status `"AUTH_FAILED"` with an explanatory message: `"Session expired or insufficient permissions. Please log in again to sync."`.
- Subsequent synchronization cycles strictly skip actions in `"AUTH_FAILED"` status and enforce a maximum retry count of 5 for transient server errors (HTTP 500), terminating infinite auto-retry loops on expired JWT/session tokens.

---

## 3. Role-Aware Mobile Shell & Navigation Implementation

### 3.1 Role-Specific Mobile Bottom Bar ([`apps/erp/src/components/layout/ErpShell.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/layout/ErpShell.tsx))
The fixed bottom navigation bar dynamically renders role-prioritized destinations while keeping the hamburger drawer for secondary modules:

| Role | Bottom Navigation Bar Items | Primary Focus |
| :--- | :--- | :--- |
| `DELIVERY_PERSON` | Stops (`/delivery`), Offline Sync (`/offline`), Sign Out | Field delivery stops, doorstep cash/UPI collection & sync |
| `OPERATIONS_MANAGER` | Dashboard (`/dashboard`), Residents (`/residents`), Kitchen (`/kitchen`), Delivery (`/delivery`), More (drawer) | Tenancy turnover, kitchen meal counts & delivery dispatch |
| `ACCOUNTANT` | Dashboard (`/dashboard`), Finance (`/finance`), Residents (`/residents`), Tiffin (`/tiffin`), More (drawer) | Cashbook ledger, invoice generation, customer collections |
| `SUPER_ADMIN` | Dashboard (`/dashboard`), Residents (`/residents`), Finance (`/finance`), Kitchen (`/kitchen`), More (drawer) | Executive oversight, financial health, multi-division reporting |

### 3.2 Mobile Touch & Safe-Area Ergonomics
- Fixed bottom bar uses `pb-safe` to accommodate iOS home indicator bars and Android system gesture insets.
- Touch targets strictly exceed 44x44px.
- Unread badge counters for notifications and pending offline actions are scoped per user session.

---

## 4. Mobile Management & Finance Workflows

### 4.1 Executive & Role Dashboards ([`apps/erp/src/app/(management)/dashboard/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/dashboard/page.tsx))
- **Live Metric Presentation:** Renders real KPIs:
  - Total Beds & Occupancy Percentage
  - Monthly Rent Collections vs Overdue Balances
  - Kitchen Headcount (Breakfast, Lunch, Dinner portions)
  - Active Delivery Tasks & In-flight Orders
- **Mobile Workflow Action Bar:**
  - Owner & Executive: Quick links to Daily Closing Reconciliation, Cashbook, Room Inventory, and Business Reports.
  - Operations: Quick links to Check In Resident, Room Transfers, Kitchen Prep Sheet, and Delivery Board.
  - Accountant: Quick links to Daily Closing, Invoicing, Cashbook, and Tiffin Customers.
- **3-Way Business Division Filter:** Consolidated, PG Guesthouse, and Tiffin Service toggles adjust financial summaries dynamically without layout shifting.

### 4.2 Cashbook Mobile Cards vs Desktop Table ([`CashbookLedger.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/finance/components/CashbookLedger.tsx))
- **Mobile View (`block md:hidden`):** Replaces horizontal table scrolling with structured cards:
  - Header: Date and Transaction Reference with one-touch ID copy.
  - Badge: Flow direction (`INFLOW` in green, `OUTFLOW` in red) and Category.
  - Core Amount: Formatted in bold INR (`₹`).
  - Metadata: Party name and payment method (`CASH`, `BANK_TRANSFER`, `UPI`, `DEPOSIT_APPLICATION`).
  - Action Bar: Direct triggers for `View Receipt` and `Reverse` (authorized staff).
- **Desktop View (`hidden md:block`):** Full 7-column tabular view preserved intact.

### 4.3 Invoice Ledger Mobile Cards vs Desktop Table ([`InvoiceLedgerView.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/finance/components/InvoiceLedgerView.tsx))
- **Mobile View (`block md:hidden`):** Replaces 9-column horizontal table with structured cards:
  - Header: Invoice Number with copy shortcut and Status Badge (`DRAFT`, `ISSUED`, `PAID`, `PARTIALLY_PAID`, `CANCELLED`).
  - Metadata: Recipient party name, bill type (`GST Tax Invoice` with rate or `Regular Bill`), and Issue/Due dates.
  - Financials: Two-column grid showing Total Amount (`₹`) and Balance Due (`₹`).
  - Action Bar: Direct buttons for Print/PDF preview, Record Payment allocation modal, and Cancel invoice.
- **Desktop View (`hidden md:block`):** Full 9-column tabular view preserved intact.

### 4.4 Daily Cashbook Closing Mobile Usability ([`DailyClosingView.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/finance/components/DailyClosingView.tsx))
- Channel breakdown tables wrapped in horizontal scroll containers with visual swipe cues.
- Denomination counters and physical cash input fields configured with large touch inputs, numeric keypads (`inputMode="numeric"`), and real-time discrepancy indicators.

---

## 5. Verification Test Suite & Results

### 5.1 Automated Test Suites
1. **Task 01B.67 Test Suite ([`tests/task01b_67_mobile_role_workflows.test.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/tests/task01b_67_mobile_role_workflows.test.ts)):**
   - **54 PASSED, 0 FAILED (100% Green)**
   - Test Suite 1: Offline Queue Security & Account Isolation (payload sanitization, token stripping, user queue isolation, 401 loop prevention)
   - Test Suite 2: Server-Side Cross-Account Replay Protection (`syncDeliveryActions` actor validation)
   - Test Suite 3: Role-Aware Mobile Bottom Navigation Invariants (`ErpShell` role customization)
   - Test Suite 4: Role-Aware Mobile Dashboard Workflows (Executive, Operations, Accountant action pills)
   - Test Suite 5: Financial Ledger Mobile Viewport Overflow Protection (card vs table layout checks)
   - Test Suite 6: Primary DB & Protected Resources Immutability Guard
2. **Task 01B.66 PWA Foundation Test Suite (`npm run test:task66`):**
   - **79 PASSED, 0 FAILED (100% Green)**
3. **Delivery Core Test Suite (`npm run test:delivery`):**
   - **171 PASSED, 0 FAILED (100% Green)**
4. **Delivery Handover & Cash Custody Test Suite (`npm run test:task58`):**
   - **84 PASSED, 0 FAILED (100% Green)**
5. **Next.js TypeScript Compiler Check (`npx tsc -p apps/erp/tsconfig.json --noEmit`):**
   - **0 errors (100% Type Safe)**
6. **Next.js Production Build (`npm run build:erp`):**
   - **Exit code 0 (Compiled successfully with 17 static routes and 100+ API endpoints)**

### 5.2 Real Device Testing Disclaimer
> [!NOTE]
> **Physical Device Status:** **NOT TESTED ON PHYSICAL HARDWARE.** All responsive layouts, touch target dimensions, safe area paddings, and viewport overflow protections were verified using simulated mobile viewport dimensions (390px, 412px, 768px), Next.js production builds, and automated DOM/component assertions. Validation on physical iOS and Android hardware must be executed during the pilot phase.

### 5.3 Database Safety Boundary
- Primary database [`data/erp.db`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/data/erp.db):
  - Size: **1,388,544 bytes**
  - LastWriteTimeUtc: **2026-10-21 08:03:43 UTC**
  - Status: **100% strictly pristine and untouched**.
- Protected Neon rehearsal database `ravi-narayana-erp-phase01b-test`: Zero queries, zero connections.

---

## 6. Deliverable Files Summary

| File | Nature of Change | Purpose |
| :--- | :--- | :--- |
| [`apps/erp/src/types/index.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/types/index.ts) | Modified | Added `userId` and `"AUTH_FAILED"` status to `QueuedDeliveryAction` |
| [`apps/erp/src/modules/delivery/offlineQueue.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/delivery/offlineQueue.ts) | Modified | Payload sanitization, user-scoped queue isolation, 401/403 loop termination |
| [`apps/erp/src/server/delivery/deliveryService.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/server/delivery/deliveryService.ts) | Modified | Server-side cross-account replay validation in `syncDeliveryActions` |
| [`apps/erp/src/app/(management)/delivery/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/delivery/page.tsx) | Modified | Passes `currentUser?.id` to offline queue, checks offline before fetch |
| [`apps/erp/src/app/offline/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/offline/page.tsx) | Modified | Reports session expiry and prevents endless retry loops |
| [`apps/erp/src/components/layout/ErpShell.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/components/layout/ErpShell.tsx) | Modified | Role-aware mobile bottom navigation bar (`SUPER_ADMIN`, `OPERATIONS_MANAGER`, `ACCOUNTANT`, `DELIVERY_PERSON`) |
| [`apps/erp/src/app/(management)/dashboard/page.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/app/(management)/dashboard/page.tsx) | Modified | Role-tailored mobile workflow quick action panels |
| [`apps/erp/src/modules/finance/components/CashbookLedger.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/finance/components/CashbookLedger.tsx) | Modified | Dual-mode responsive layout: mobile cards with receipt view/reversal vs desktop table |
| [`apps/erp/src/modules/finance/components/InvoiceLedgerView.tsx`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/apps/erp/src/modules/finance/components/InvoiceLedgerView.tsx) | Modified | Dual-mode responsive layout: mobile cards with print/allocate vs desktop table |
| [`tests/task01b_67_mobile_role_workflows.test.ts`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/tests/task01b_67_mobile_role_workflows.test.ts) | Created | 54 automated assertions covering security, isolation, navigation, and mobile UI |
| [`package.json`](file:///c:/Users/Rishabh/Desktop/raviNarayana-Erp/package.json) | Modified | Registered `"test:task67"` script and chained into `"test"` |
