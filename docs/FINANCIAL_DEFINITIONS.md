# Financial definitions

Canonical meaning of every money figure the dashboard and reports show. Implemented once in `apps/erp/src/server/finance/financialDefinitions.ts`; other code must use those helpers instead of writing its own SQL for these figures.

**Common rules**
- Only `POSTED` ledger rows count. Reversing a row sets the original to `REVERSED`; the `REVERSAL` counter-row is never counted. So a reversal removes the original from every figure here.
- Dates are business dates in Asia/Kolkata (`lib/businessDate.ts`), never the UTC calendar date.
- Amounts are integer rupees.

| Figure | Definition | Notes |
|---|---|---|
| **Rent settled** (dashboard "rent", 6-month chart) | `RENT_PAYMENT` rows, **including** deposit applications, excluding tiffin rows (`customer_id` set or category `TIFFIN`) | A deposit applied to rent is rent recognised (rule from Task 01B.63). |
| **Rent received in cash/bank** (cashbook) | `RENT_PAYMENT`, excluding deposit applications and tiffin rows | A deposit application creates no cash inflow. |
| **Tiffin received** | `TIFFIN_PAYMENT`, plus legacy `RENT_PAYMENT` rows that carry a `customer_id` or category `TIFFIN` | No description text matching. A row is tiffin *or* rent, never both. |
| **Rent outstanding** | For each resident: Σ `RENT_CHARGE` − Σ rent settled. Total = sum of the **positive** balances only | Example: A owes ₹5,000, B owes ₹3,000, C is ₹2,000 in credit → ₹8,000. C's credit is not netted against the others. |
| **Residents with dues** | Count of residents whose balance above is positive | |
| **Deposits held** | For each resident: Σ `SECURITY_DEPOSIT` − Σ `DEPOSIT_REFUND` − Σ deposit applications − Σ checkout deductions kept (`resident_settlements.deductions_amount`). Total = sum of positive balances | Deductions are kept by the business and are not ledger rows, so they must be subtracted here. A deposit not yet refunded after checkout is still owed and is still held. Grouped per resident because deposit rows may carry no stay id. |

**Adjustments.** There is no separate deposit-adjustment transaction type today. A deposit correction is made by reversing the original row and recording it again, which the rules above already handle.

Verified on live PostgreSQL by `tests/pg_financial_definitions.test.ts`.
