import { AsyncDb } from "../database/db";

/**
 * Canonical money definitions shared by the dashboard and reports (documented in
 * docs/FINANCIAL_DEFINITIONS.md). Every figure counts POSTED rows only: a reversed row keeps
 * status REVERSED and its REVERSAL counter-row is never counted, so a reversal removes the
 * original from every total below.
 */

/** Tiffin money received: tiffin payments, plus legacy rent-typed rows that belong to a tiffin customer. */
export const TIFFIN_RECEIPT_SQL = `(transaction_type = 'TIFFIN_PAYMENT' OR (transaction_type = 'RENT_PAYMENT' AND (customer_id IS NOT NULL OR category = 'TIFFIN')))`;

/**
 * Rent money received: rent payments from residents. Excludes deposit applications (non-cash: the
 * deposit already counted when it was received) and tiffin rows, so nothing is counted twice.
 */
export const RENT_RECEIPT_SQL = `(transaction_type = 'RENT_PAYMENT' AND COALESCE(category, '') NOT IN ('DEPOSIT_APPLICATION', 'TIFFIN') AND customer_id IS NULL)`;

/**
 * Rent settled: rent payments including deposit applications, excluding tiffin rows. This is what
 * reduces a resident's dues, and what the dashboard reports as rent (a deposit applied to rent is
 * rent recognised; Task 01B.63). The cash-only view is the cashbook, which uses RENT_RECEIPT_SQL.
 */
export const RENT_SETTLEMENT_SQL = `(transaction_type = 'RENT_PAYMENT' AND COALESCE(category, '') <> 'TIFFIN' AND customer_id IS NULL)`;

export interface OutstandingRent {
  /** Sum of positive balances, resident by resident (one resident's credit never hides another's debt). */
  total: number;
  /** Residents with a positive balance. */
  residents: number;
}

/** Rent outstanding per resident: Σ rent charges − Σ rent settlements, counting only residents who owe. */
export async function getOutstandingRent(db: AsyncDb): Promise<OutstandingRent> {
  const row = await db.queryOne<{ total: number | string; residents: number | string }>(`
    SELECT COALESCE(SUM(due), 0) as total, COUNT(*) as residents
    FROM (
      SELECT resident_id,
        SUM(CASE WHEN transaction_type = 'RENT_CHARGE' THEN amount ELSE 0 END) -
        SUM(CASE WHEN ${RENT_SETTLEMENT_SQL} THEN amount ELSE 0 END) as due
      FROM financial_transactions
      WHERE status = 'POSTED' AND resident_id IS NOT NULL
      GROUP BY resident_id
    ) balances
    WHERE due > 0
  `);
  return { total: Number(row?.total || 0), residents: Number(row?.residents || 0) };
}

/**
 * Refundable security deposits still held, resident by resident:
 *   deposits received − deposit applications to rent − refunds − deductions kept at checkout.
 * Checkout deductions are not ledger rows (they stay in resident_settlements), so they are
 * subtracted here; without that a settled stay would still show its deductions as "held".
 * Grouped per resident because deposit rows may carry no stay id (the checkout settlement reads
 * them the same way). A resident never contributes a negative amount.
 */
export async function getDepositsHeld(db: AsyncDb): Promise<number> {
  const row = await db.queryOne<{ held: number | string }>(`
    SELECT COALESCE(SUM(CASE WHEN held > 0 THEN held ELSE 0 END), 0) as held
    FROM (
      SELECT d.resident_id, d.ledger_held - COALESCE(s.kept, 0) as held
      FROM (
        SELECT resident_id,
          SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' THEN amount ELSE 0 END) -
          SUM(CASE WHEN transaction_type = 'DEPOSIT_REFUND' THEN amount ELSE 0 END) -
          SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND COALESCE(category, '') = 'DEPOSIT_APPLICATION' THEN amount ELSE 0 END) as ledger_held
        FROM financial_transactions
        WHERE status = 'POSTED' AND resident_id IS NOT NULL
          AND transaction_type IN ('SECURITY_DEPOSIT', 'DEPOSIT_REFUND', 'RENT_PAYMENT')
        GROUP BY resident_id
      ) d
      LEFT JOIN (
        SELECT resident_id, SUM(deductions_amount) as kept FROM resident_settlements GROUP BY resident_id
      ) s ON s.resident_id = d.resident_id
    ) per_resident
  `);
  return Number(row?.held || 0);
}
