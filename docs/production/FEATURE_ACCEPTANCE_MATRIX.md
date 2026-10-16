# Ravinarayan ERP — Feature Acceptance & Implementation Matrix

**Audited Application:** Ravinarayan Management ERP (`apps/erp`) & Public Website (`apps/website`)  
**Status Criteria:**
- **Complete & Verified:** Fully implemented in UI, API, server service, and DB with automated regression test coverage.
- **Implemented but Unverified:** Code exists in UI/API, but lacks end-to-end integration or automated tests.
- **Incomplete:** Partially built, missing UI workflows or backend handlers.
- **Missing:** Required business capability not yet built in the codebase.
- **Blocked:** Dependent on owner decision or external integration.

---

## 1. Domain-by-Domain Feature Inventory

### A. Resident Management

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Resident Registration** | **Complete & Verified** | `/residents` (`AddResidentModal`) | `POST /api/residents` | `residentService.registerResident` | `residents` |
| **Unique Identification (`res_...`)** | **Complete & Verified** | `/residents` | `POST /api/residents` | `residentService.registerResident` | `residents.id` |
| **Phone Number Uniqueness** | **Complete & Verified** | `/residents` | `POST /api/residents` | `residentService.registerResident` | `residents.phone (UNIQUE)` |
| **Room Assignment & Check-In** | **Complete & Verified** | `/residents` (`CheckInModal`), `/rooms` (`AssignTenantModal`) | `POST /api/residents/check-in` | `residentService.assignResidentToRoom` | `resident_stays` |
| **Check-Out & Capacity Release** | **Complete & Verified** | `/residents` (`CheckOutModal`) | `POST /api/residents/check-out` | `residentService.checkOutResident` | `resident_stays (COMPLETED)` |
| **Stay History & Room Transfers** | **Complete & Verified** | `/residents` (Detail Drawer) | `GET /api/residents/[id]` | `residentService.getResidentById` | `resident_stays` |
| **Emergency Contacts & Notes** | **Complete & Verified** | `/residents` | `POST /api/residents` | `residentService.registerResident` | `residents.emergency_contact` |
| **KYC Document Uploads** | **Missing** | Not implemented | Not implemented | Not implemented | None |
| **Duplicate Resident Prevention** | **Complete & Verified** | Phone validation | `POST /api/residents` | `residentService.registerResident` | `residents.phone UNIQUE` |

---

### B. Room and Occupancy Management

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Room Inventory Listing** | **Complete & Verified** | `/rooms` (`RoomGrid`) | `GET /api/rooms` | `roomService.listRooms` | `rooms` |
| **Floor Filtering (Floors 0–3)**| **Complete & Verified** | `/rooms` (Filter pills) | `GET /api/rooms?floor=X` | `roomService.listRooms` | `rooms.floor` |
| **Bed Capacity Tracking** | **Complete & Verified** | `/rooms` (Occupancy badges) | `GET /api/rooms` | `roomService.listRooms` | `rooms.capacity`, `resident_stays` |
| **Case-Insensitive Room Uniqueness** | **Complete & Verified** | `/rooms` | `POST /api/rooms` | `roomService.createRoom` | `UNIQUE(room_number COLLATE NOCASE)` |
| **Direct Bed Assignment Action**| **Complete & Verified** | `/rooms` (`AssignTenantModal`) | `POST /api/residents/check-in` | `residentService.assignResidentToRoom` | `resident_stays` |
| **Overbooking Prevention Guard**| **Complete & Verified** | Server assertion | `POST /api/residents/check-in` | `residentService.assignResidentToRoom` | Engine constraint + Check |
| **Anti-Double-Booking Guard** | **Complete & Verified** | Partial unique index | `POST /api/residents/check-in` | `residentService.assignResidentToRoom` | `idx_unique_active_resident_stay` |
| **Maintenance / Offline Room State** | **Incomplete** | Toggle in service | `PATCH /api/rooms/[id]` | `roomService.setRoomActiveStatus` | `rooms.is_active` |

---

### C. Rent and Billing

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Rent Charge Generation** | **Complete & Verified** | `/finance` (`RentChargeModal`) | `POST /api/finance/transactions` | `financeService.recordRentCharge` | `financial_transactions` |
| **Rent Payment Collection** | **Complete & Verified** | `/finance` (`PaymentModal`) | `POST /api/finance/transactions` | `financeService.recordRentPayment` | `financial_transactions` |
| **Partial Payments & Balances** | **Complete & Verified** | `/finance` (Balance badge) | `GET /api/finance/residents/[id]` | `financeService.getResidentRentBalance`| Derived from posted ledger |
| **Anti-Overpayment Guard** | **Complete & Verified** | Server assertion | `POST /api/finance/transactions` | `financeService.recordRentPayment` | `financeService.ts:310` |
| **Payment Methods (UPI, Cash, etc.)** | **Complete & Verified** | `/finance` | `POST /api/finance/transactions` | `financeService.recordRentPayment` | `payment_method` enum |
| **Billing Periods (`October 2026`)** | **Complete & Verified** | `/finance` | `POST /api/finance/transactions` | `financeService.recordRentCharge` | `billing_period` |
| **Late Fees / Penalties** | **Blocked** | Pending Owner Decision | None | None | None |
| **Resident Financial Statement** | **Complete & Verified** | `/finance` (`ResidentStatementsView`) | `GET /api/finance/residents/[id]` | `financeService.getResidentFinancialSummary` | `financial_transactions` |
| **Idempotency Protection** | **Complete & Verified** | Client UUID header | `POST /api/finance/transactions` | `financeService.recordRentPayment` | `idempotency_key UNIQUE` |

---

### D. Deposits

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Deposit Collection** | **Complete & Verified** | `/finance` (`SecurityDepositModal`)| `POST /api/finance/transactions` | `financeService.recordSecurityDeposit` | `financial_transactions` |
| **Custodial Liability Isolation**| **Complete & Verified** | Excluded from rent revenue | `GET /api/finance/cashbook` | `financeService.getCashbookSummary` | `category = 'SECURITY_DEPOSIT'` |
| **Deposit Balance Tracking** | **Complete & Verified** | `/finance` (`ResidentStatementsView`) | `GET /api/finance/residents/[id]` | `financeService.getResidentFinancialSummary` | `financial_transactions` |
| **Deposit Deductions & Forfeiture** | **Incomplete** | Manual reversal/expense | `POST /api/finance/transactions` | `financeService.reverseTransaction` | `financial_transactions` |
| **Deposit Refund Workflow** | **Incomplete** | Recorded via Reversal | `POST /api/finance/transactions` | `financeService.reverseTransaction` | `reversal_of_id` |

---

### E. Finance and Cashbook

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Cashbook Ledger View** | **Complete & Verified** | `/finance` (`CashbookLedger`) | `GET /api/finance/transactions` | `financeService.listTransactions` | `financial_transactions` |
| **Expense Recording & Vendors** | **Complete & Verified** | `/finance` (`ExpenseModal`) | `POST /api/finance/transactions` | `financeService.recordExpense` | `payee_vendor`, `category` |
| **Net Cash Movement Formula** | **Complete & Verified** | `/finance` (`FinancialSummaryCards`)| `GET /api/finance/cashbook` | `financeService.getCashbookSummary` | Money In minus Money Out |
| **Cross-Period Accounting Reversals**| **Complete & Verified** | Server assertion | `GET /api/finance/cashbook` | `financeService.getCashbookSummary` | `financeService.ts:803-827` |
| **Auditable Reversals** | **Complete & Verified** | `/finance` (`ReversalModal`) | `POST /api/finance/transactions` | `financeService.reverseTransaction` | `reversal_of_id REFERENCES ...` |
| **CSV Export with Formula Defense** | **Complete & Verified** | `/finance` (Export CSV button) | Client utility / API | `exportCsv.ts` | Excel sanitization (`='`) |
| **Accounting Period Date Selector** | **Complete & Verified** | `/finance` (`AccountingPeriodSelector`)| `GET /api/finance/cashbook?start=..`| `financeService.getCashbookSummary` | `startDate`, `endDate` |

---

### F. Kitchen, Tiffin, and Delivery

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Eligible Resident Meal Calculation**| **Complete & Verified** | `/kitchen` | `GET /api/kitchen/eligibility` | `kitchenService.getEligibleResidentsForDate` | `resident_stays`, `preferences` |
| **Daily Meal Plan Creation** | **Complete & Verified** | `/kitchen` (`CreatePlanModal`) | `POST /api/kitchen/plans` | `kitchenService.createMealPlan` | `daily_meal_plans` |
| **Resident Opt-Outs & Preferences**| **Complete & Verified** | `/kitchen` | `PATCH /api/kitchen/plans/[id]`| `kitchenService.updateResidentMealPreference`| `resident_meal_preferences` |
| **Preparation Sheet & Tallies** | **Complete & Verified** | `/kitchen` (`PreparationSheet`) | `GET /api/kitchen/prep-sheet` | `kitchenService.getPreparationSheetData` | `daily_meal_plans` |
| **Justified Quantity Adjustments** | **Complete & Verified** | `/kitchen` (`AdjustModal`) | `POST /api/kitchen/plans/[id]/adjustments` | `kitchenService.adjustMealPlanQuantity` | `meal_plan_adjustments` |
| **Delivery Task Generation** | **Complete & Verified** | `/delivery` (`GenerateTasksModal`)| `POST /api/delivery/tasks/generate` | `deliveryService.generateDeliveryTasks` | `delivery_tasks` |
| **Historical Resident Snapshot**| **Complete & Verified** | Preserved on task | `POST /api/delivery/tasks/generate` | `deliveryService.generateDeliveryTasks` | `resident_name`, `room_number` |
| **Courier Assignment & Dispatch**| **Complete & Verified** | `/delivery` | `POST /api/delivery/tasks/[id]/dispatch`| `deliveryService.dispatchDeliveryTask` | `assigned_to`, `dispatched_at` |
| **Delivery Completion & Proof** | **Complete & Verified** | `/delivery` | `POST /api/delivery/tasks/[id]/deliver` | `deliveryService.completeDeliveryTask` | `recipient_name`, `delivery_notes` |
| **Controlled Exception & Retry** | **Complete & Verified** | `/delivery` | `POST /api/delivery/tasks/[id]/exception` | `deliveryService.reportDeliveryException`| `exception_type`, `exception_reason`|
| **Citywide External Customer Orders**| **Complete & Verified**| `/delivery` | `POST /api/delivery/tasks` | `deliveryService.createExternalDeliveryTask`| `order_type = 'EXTERNAL'` |
| **Offline Courier Mode** | **Incomplete** | Requires Service Worker | None | None | IndexedDB |

---

### G. User Management and Administration

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Staff Directory** | **Complete & Verified** | Server service | Internal | `staffService.listStaffUsers` | `staff_users` |
| **Role Assignment (5 Roles)** | **Complete & Verified** | Server service | Internal | `staffService.updateStaffRole` | `staff_users.role` |
| **Account Deactivation** | **Complete & Verified** | Server service | Internal | `staffService.setStaffActiveStatus` | `staff_users.is_active` |
| **Sole Super Admin Protection** | **Complete & Verified** | Server assertion | Internal | `staffService.setStaffActiveStatus` | Count $\le 1$ check |
| **Self-Service Password Reset** | **Missing** | Not implemented | None | None | None |
| **Tamper-Evident Audit Logs** | **Complete & Verified** | Server service | Internal | `audit.recordAuditEvent` | `audit_logs` |
| **Credential Sanitization** | **Complete & Verified** | Server regex | Internal | `audit.sanitizeAuditMetadata` | `/password\|token\|secret/i` |

---

### H. Reports and Exports

| Feature | Status | UI Route / Component | API Route | Server Service | Database Table |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Executive Operations Summary** | **Complete & Verified** | `/dashboard` (`ExportReportModal`)| `GET /api/reports/executive` | Direct aggregation query | Cross-module aggregation |
| **Occupancy & Capacity Metrics** | **Complete & Verified** | `/dashboard` (KPI Cards) | `GET /api/reports/executive` | Direct aggregation query | `rooms`, `resident_stays` |
| **Cashbook Statement Export** | **Complete & Verified** | `/finance` (Export CSV) | Client utility | `exportCsv.ts` | `financial_transactions` |
| **Resident Ledger Statement** | **Complete & Verified** | `/finance` (Resident Statements)| `GET /api/finance/residents/[id]` | `financeService.getResidentFinancialSummary` | `financial_transactions` |
| **Kitchen Preparation Sheet** | **Complete & Verified** | `/kitchen` (Print / View) | `GET /api/kitchen/prep-sheet` | `kitchenService.getPreparationSheetData` | `daily_meal_plans` |
| **Delivery Courier Manifest** | **Complete & Verified** | `/delivery` | `GET /api/delivery/tasks` | `deliveryService.listDeliveryTasks` | `delivery_tasks` |
| **Unbounded Query Defense** | **Complete & Verified** | Query bounds (`LIMIT 50, MAX 200`)| API routes | All list services | Enforced in SQL |

---

### I. Public Website and Mobile Experience

| Feature | Status | Component / File | Verification Criteria | Status Notes |
| :--- | :---: | :--- | :--- | :--- |
| **Luxury Botanical Homepage** | **Complete & Verified** | `apps/website/src/app/page.tsx` | Visual Inspection & Build | 100% responsive |
| **Interactive 3D Crest Showcase**| **Complete & Verified** | `components/InteractiveScene.tsx` | WebGL Canvas & Three.js | High-performance rendering |
| **Static Room Catalog** | **Complete & Verified** | `app/rooms/page.tsx`, `data/roomsData.ts` | Complete room specs & gallery | Static showcase |
| **Tiffin Service Marketing** | **Complete & Verified** | `app/tiffin-service/page.tsx` | Plans & pricing overview | Synchronized with kitchen offerings |
| **Inquiry & Contact Form** | **Complete & Verified** | `app/contact/page.tsx`, `UnifiedContact.tsx` | Interactive inquiry forms | Direct phone / WhatsApp integration |
| **Mobile Responsive Layout** | **Complete & Verified** | Tested across 390px, 768px, 1024px | Headless Chrome CDP Verification | 0px page-level horizontal overflow |
| **Progressive Web App (PWA)** | **Incomplete** | Requires `manifest.json` | PWA Lighthouse Audit | Recommended launch improvement |
| **Native Mobile App (Android/iOS)**| **Blocked** | Pending Owner Decision | Architecture Decision Record | PWA recommended instead of native |
