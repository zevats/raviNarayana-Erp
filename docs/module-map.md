# Ravinarayan ERP — Business Module Map & Boundaries

This document defines the module boundaries and contracts for the Ravinarayan Management ERP (`apps/erp/src/modules/`).

---

## 1. Module Inventory & Status

| Module | Directory | Phase | Status | Primary Responsibilities |
| :--- | :--- | :---: | :---: | :--- |
| **Authentication** | `modules/auth/` | 1 | **ACTIVE** | Staff login, session lifecycle, password verification, rate limiting. |
| **Staff & Roles** | `modules/staff/` | 2 | *Planned* | Staff directory, role assignments, account activation/deactivation. |
| **Rooms & Occupancy**| `modules/rooms/` | 3 | *Planned* | Room inventory, bed configurations, occupancy state machine. |
| **Residents** | `modules/residents/` | 3 | *Planned* | Resident records, KYC documents, check-in/out timestamps, stay logs. |
| **Finance & Cashbook**| `modules/finance/` | 4 | *Planned* | Rent tracking, security deposits, meal payments, expenses, cashbook. |
| **Tiffin Plans** | `modules/tiffin/` | 5 | *Planned* | Customer subscriptions, meal preferences, pause/resume schedules. |
| **Kitchen Ops** | `modules/kitchen/` | 5 | *Planned* | Daily prep quantities (breakfast, lunch, dinner), packing tallies. |
| **Delivery Workflow** | `modules/delivery/` | 6 | *Planned* | Mobile dispatch tasks, delivery statuses, failure codes, reconciliation. |
| **Reports** | `modules/reports/` | 7 | *Planned* | Verified operational summaries, occupancy reports, revenue logs. |
| **Security Audit** | `modules/audit/` | 7 | *Planned* | Immutable audit logging of sensitive business and administrative events. |

---

## 2. Role Permissions Matrix

The ERP enforces 5 distinct operational roles:

```text
Role                         Permissions
─────────────────────────────────────────────────────────────────────────────
SUPER_ADMIN                  Full administrative, financial, and operational access.
OPERATIONS_MANAGER           Rooms, residents, kitchen, delivery, staff view. No raw DB.
ACCOUNTANT                   Rent, payments, expenses, resident balances, financial reports.
KITCHEN_OPERATIONS           Daily meal prep totals, packing lists, tiffin changes.
DELIVERY_PERSON              Assigned delivery tasks only. Strictly NO financial access.
```

---

## 3. Delivery Workflow Foundation (Phase 6 Preparation)

In accordance with Phase 1 Step 6:
- The delivery module is decoupled from financial records.
- Status machine:
  `PENDING_ASSIGNMENT` &rarr; `DISPATCHED` &rarr; `IN_TRANSIT` &rarr; `DELIVERED` or `FAILED` or `CUSTOMER_UNAVAILABLE`.
- Compulsory failure reasons on unsuccessful delivery.
- Mobile layout ready for on-the-road couriers.
