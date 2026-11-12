import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { acquireClosingExclusiveLock } from "./financeService";
import {
  AuthenticatedUser,
  PaymentMethod,
  CANONICAL_PAYMENT_METHODS,
  ClosingDivision,
  ClosingStatus,
  DailyClosingPreview,
  ChannelMovementBreakdown,
  DeliveryReconciliationSummary,
  SaveDailyClosingDraftInput,
  FinalizeDailyClosingInput,
  ReopenDailyClosingInput,
  DailyClosingRecord,
  ListDailyClosingsFilter,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function mapRowToClosingRecord(row: any): DailyClosingRecord {
  return {
    id: row.id,
    closingDate: row.closing_date,
    division: row.division as ClosingDivision,
    openingBalance: Number(row.opening_balance || 0),
    openingCashBalance: Number(row.opening_cash_balance || 0),
    cashInflow: Number(row.cash_inflow || 0),
    upiInflow: Number(row.upi_inflow || 0),
    bankTransferInflow: Number(row.bank_transfer_inflow || 0),
    chequeInflow: Number(row.cheque_inflow || 0),
    otherInflow: Number(row.other_inflow || 0),
    cashOutflow: Number(row.cash_outflow || 0),
    upiOutflow: Number(row.upi_outflow || 0),
    bankTransferOutflow: Number(row.bank_transfer_outflow || 0),
    chequeOutflow: Number(row.cheque_outflow || 0),
    otherOutflow: Number(row.other_outflow || 0),
    totalInflow: Number(row.total_inflow || 0),
    totalOutflow: Number(row.total_outflow || 0),
    expectedClosingBalance: Number(row.expected_closing_balance || 0),
    expectedCashBalance: Number(row.expected_cash_balance || 0),
    actualCashCounted: row.actual_cash_counted !== null && row.actual_cash_counted !== undefined ? Number(row.actual_cash_counted) : null,
    actualBankVerified: row.actual_bank_verified !== null && row.actual_bank_verified !== undefined ? Number(row.actual_bank_verified) : null,
    actualTotalBalance: row.actual_total_balance !== null && row.actual_total_balance !== undefined ? Number(row.actual_total_balance) : null,
    cashDiscrepancy: Number(row.cash_discrepancy || 0),
    totalDiscrepancy: Number(row.total_discrepancy || 0),
    discrepancyReason: row.discrepancy_reason || null,
    status: row.status as ClosingStatus,
    preparedBy: row.prepared_by,
    preparedByName: row.prepared_by_name || null,
    finalizedBy: row.finalized_by || null,
    finalizedByName: row.finalized_by_name || null,
    finalizedAt: row.finalized_at || null,
    reopenedBy: row.reopened_by || null,
    reopenedByName: row.reopened_by_name || null,
    reopenedAt: row.reopened_at || null,
    reopenReason: row.reopen_reason || null,
    notes: row.notes || null,
    snapshotData: row.snapshot_data || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Calculates opening balance for a specific date and division.
 * 1. Looks for the most recent FINALIZED closing prior to closingDate.
 * 2. If none exists, computes cumulative historical net movement up to closingDate.
 */
async function computeOpeningBalances(
  db: AsyncDb,
  closingDate: string,
  division: ClosingDivision
): Promise<{ openingBalance: number; openingCashBalance: number }> {
  // Without a finalized closing before this date the opening is the whole ledger before it. Both
  // are read together (one round trip) and the ledger is summed in the database (the same rule as
  // movementDirection below), instead of sending every historical entry to the server.
  let divisionFilter = "";
  if (division === "PG") {
    divisionFilter = "AND (ft.resident_id IS NOT NULL OR ft.transaction_type IN ('RENT_PAYMENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND', 'RENT_CHARGE'))";
  } else if (division === "TIFFIN") {
    divisionFilter = "AND (ft.customer_id IS NOT NULL OR ft.transaction_type IN ('TIFFIN_PAYMENT', 'TIFFIN_CHARGE'))";
  }
  const dir = movementDirectionSql("ft", "orig");
  const [priorClosing, sums] = await Promise.all([
    db.queryOne<any>(`
    SELECT *
    FROM daily_cashbook_closings
    WHERE closing_date < ? AND division = ? AND status = 'FINALIZED'
    ORDER BY closing_date DESC
    LIMIT 1
  `, [closingDate, division]),
    db.queryOne<{ total: number | string | null; cash: number | string | null }>(`
    SELECT
      COALESCE(SUM(ft.amount * (${dir})), 0) AS total,
      COALESCE(SUM(CASE WHEN ft.payment_method = 'CASH' THEN ft.amount * (${dir}) ELSE 0 END), 0) AS cash
    FROM financial_transactions ft
    LEFT JOIN financial_transactions orig ON ft.reversal_of_id = orig.id
    WHERE ft.transaction_date < ?
      ${divisionFilter}
  `, [closingDate]),
  ]);

  if (priorClosing) {
    const openingBal = priorClosing.actual_total_balance !== null && priorClosing.actual_total_balance !== undefined
      ? Number(priorClosing.actual_total_balance)
      : Number(priorClosing.expected_closing_balance || 0);

    const openingCashBal = priorClosing.actual_cash_counted !== null && priorClosing.actual_cash_counted !== undefined
      ? Number(priorClosing.actual_cash_counted)
      : Number(priorClosing.expected_cash_balance || 0);

    return {
      openingBalance: openingBal,
      openingCashBalance: openingCashBal,
    };
  }

  return {
    openingBalance: Number(sums?.total || 0),
    openingCashBalance: Number(sums?.cash || 0),
  };
}

/** receiptOrPaymentDirection as SQL for a type/category pair of columns. */
function receiptOrPaymentDirectionSql(type: string, category: string): string {
  return `CASE WHEN (${type} = 'RENT_PAYMENT' AND COALESCE(${category}, '') <> 'DEPOSIT_APPLICATION') OR ${type} IN ('SECURITY_DEPOSIT', 'TIFFIN_PAYMENT') THEN 1
               WHEN ${type} IN ('EXPENSE', 'DEPOSIT_REFUND') THEN -1 ELSE 0 END`;
}

/** movementDirection as SQL: `t` is the entry, `o` the entry a reversal reverses. */
function movementDirectionSql(t: string, o: string): string {
  return `CASE
    WHEN ${t}.status = 'POSTED' AND ${t}.transaction_type = 'REVERSAL' THEN -(${receiptOrPaymentDirectionSql(`COALESCE(${o}.transaction_type, '')`, `${o}.category`)})
    WHEN ${t}.status = 'POSTED' THEN ${receiptOrPaymentDirectionSql(`${t}.transaction_type`, `${t}.category`)}
    WHEN ${t}.status = 'REVERSED' AND ${t}.reversal_of_id IS NULL THEN ${receiptOrPaymentDirectionSql(`${t}.transaction_type`, `${t}.category`)}
    ELSE 0 END`;
}

/** +1 money came in, -1 money went out, 0 a charge or other bookkeeping entry. */
function receiptOrPaymentDirection(type: string, category: string | null): number {
  if ((type === "RENT_PAYMENT" && category !== "DEPOSIT_APPLICATION") || type === "SECURITY_DEPOSIT" || type === "TIFFIN_PAYMENT") return 1;
  if (type === "EXPENSE" || type === "DEPOSIT_REFUND") return -1;
  return 0;
}

/**
 * How a ledger row moves money on its own date. A reversal moves it the opposite way to the
 * entry it reverses, so reversing a rent or tiffin charge (no money moved) is not an outflow.
 * An original that was reversed later still counts on its own date.
 */
function movementDirection(row: { status: string; transaction_type: string; category: string | null; reversal_of_id: string | null; orig_tx_type: string | null; orig_category: string | null }): number {
  if (row.status === "POSTED") {
    if (row.transaction_type === "REVERSAL") return -receiptOrPaymentDirection(row.orig_tx_type ?? "", row.orig_category);
    return receiptOrPaymentDirection(row.transaction_type, row.category);
  }
  if (row.status === "REVERSED" && !row.reversal_of_id) return receiptOrPaymentDirection(row.transaction_type, row.category);
  return 0;
}

/**
 * Previews the daily closing calculation for a given date and division.
 * Returns opening balances, channel breakdowns, delivery status, and any existing closing record.
 */
export async function previewDailyClosing(
  actor: AuthenticatedUser,
  closingDate: string,
  division: ClosingDivision = "COMBINED",
  asyncDb?: AsyncDb
): Promise<DailyClosingPreview> {
  requirePermission(actor, "finance.read");

  if (!closingDate || !DATE_REGEX.test(closingDate)) {
    throw new Error("Invalid closingDate format. Expected YYYY-MM-DD.");
  }

  const db = asyncDb ?? getAsyncDb();

  // Opening balances, the day's entries, the day's deliveries and any saved closing are independent:
  // they are read together (one round trip).
  const openingP = computeOpeningBalances(db, closingDate, division);

  // 2. Fetch all transactions for closingDate
  let divisionFilter = "";
  const params: any[] = [closingDate];

  if (division === "PG") {
    divisionFilter = "AND (ft.resident_id IS NOT NULL OR ft.transaction_type IN ('RENT_PAYMENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND', 'RENT_CHARGE'))";
  } else if (division === "TIFFIN") {
    divisionFilter = "AND (ft.customer_id IS NOT NULL OR ft.transaction_type IN ('TIFFIN_PAYMENT', 'TIFFIN_CHARGE'))";
  }

  const txRowsP = db.query<any>(`
    SELECT
      ft.id,
      ft.transaction_type,
      ft.amount,
      ft.transaction_date,
      ft.payment_method,
      ft.reference_number,
      ft.resident_id,
      ft.customer_id,
      ft.category,
      ft.description,
      ft.status,
      ft.reversal_of_id,
      ft.created_at,
      r.full_name as resident_name,
      rm.room_number,
      tc.full_name as customer_name,
      orig.transaction_type as orig_tx_type,
      orig.category as orig_category
    FROM financial_transactions ft
    LEFT JOIN residents r ON ft.resident_id = r.id
    LEFT JOIN resident_stays rs ON ft.stay_id = rs.id
    LEFT JOIN rooms rm ON rs.room_id = rm.id
    LEFT JOIN tiffin_customers tc ON ft.customer_id = tc.id
    LEFT JOIN financial_transactions orig ON ft.reversal_of_id = orig.id
    WHERE ft.transaction_date = ?
      ${divisionFilter}
    ORDER BY ft.created_at ASC
  `, params);
  // 3. Delivery operational summary
  const deliveryRowsP = db.query<any>(`
    SELECT
      COUNT(*) as total_tasks,
      COALESCE(SUM(CASE WHEN order_type = 'RESIDENT' THEN 1 ELSE 0 END), 0) as resident_tasks,
      COALESCE(SUM(CASE WHEN order_type = 'EXTERNAL' THEN 1 ELSE 0 END), 0) as external_tasks,
      COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered_count,
      COALESCE(SUM(CASE WHEN status IN ('PENDING', 'ASSIGNED', 'DISPATCHED') THEN 1 ELSE 0 END), 0) as pending_count,
      COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exception_count
    FROM delivery_tasks
    WHERE service_date = ?
  `, [closingDate]);
  // 4. Check existing closing record
  const existingClosingRowP = db.queryOne<any>(`
    SELECT
      dcc.*,
      p.full_name as prepared_by_name,
      f.full_name as finalized_by_name,
      r.full_name as reopened_by_name
    FROM daily_cashbook_closings dcc
    LEFT JOIN staff_users p ON dcc.prepared_by = p.id
    LEFT JOIN staff_users f ON dcc.finalized_by = f.id
    LEFT JOIN staff_users r ON dcc.reopened_by = r.id
    WHERE dcc.closing_date = ? AND dcc.division = ?
  `, [closingDate, division]);
  const [{ openingBalance, openingCashBalance }, txRows, deliveryRows, existingClosingRow] = await Promise.all([openingP, txRowsP, deliveryRowsP, existingClosingRowP]);

  // Initialize channel breakdown
  const channelBreakdown: Record<PaymentMethod, ChannelMovementBreakdown> = {
    CASH: { channel: "CASH", inflow: 0, outflow: 0, net: 0, transactionCount: 0 },
    UPI: { channel: "UPI", inflow: 0, outflow: 0, net: 0, transactionCount: 0 },
    BANK_TRANSFER: { channel: "BANK_TRANSFER", inflow: 0, outflow: 0, net: 0, transactionCount: 0 },
    CHEQUE: { channel: "CHEQUE", inflow: 0, outflow: 0, net: 0, transactionCount: 0 },
    OTHER: { channel: "OTHER", inflow: 0, outflow: 0, net: 0, transactionCount: 0 },
  };

  let totalInflow = 0;
  let totalOutflow = 0;
  const activeTxList: any[] = [];

  for (const row of txRows) {
    const amt = Number(row.amount || 0);
    const method = (row.payment_method as PaymentMethod) || "OTHER";
    const bucket = channelBreakdown[method] || channelBreakdown.OTHER;

    activeTxList.push({
      id: row.id,
      transactionType: row.transaction_type,
      amount: amt,
      paymentMethod: row.payment_method || null,
      referenceNumber: row.reference_number || null,
      category: row.category,
      description: row.description || null,
      residentName: row.resident_name || null,
      customerName: row.customer_name || null,
      roomNumber: row.room_number || null,
      status: row.status,
      createdAt: row.created_at,
    });

    const dir = movementDirection(row);
    if (dir === 0) continue;
    bucket.transactionCount += 1;
    if (dir > 0) {
      bucket.inflow += amt;
      bucket.net += amt;
      totalInflow += amt;
    } else {
      bucket.outflow += amt;
      bucket.net -= amt;
      totalOutflow += amt;
    }
  }

  const netMovement = totalInflow - totalOutflow;
  const expectedClosingBalance = openingBalance + netMovement;
  const expectedCashBalance = openingCashBalance + (channelBreakdown.CASH.inflow - channelBreakdown.CASH.outflow);


  const delRow = deliveryRows[0] || {};
  const deliverySummary: DeliveryReconciliationSummary = {
    totalTasks: Number(delRow.total_tasks || 0),
    residentTasks: Number(delRow.resident_tasks || 0),
    externalTasks: Number(delRow.external_tasks || 0),
    deliveredCount: Number(delRow.delivered_count || 0),
    pendingCount: Number(delRow.pending_count || 0),
    exceptionCount: Number(delRow.exception_count || 0),
  };


  const existingClosing = existingClosingRow ? mapRowToClosingRecord(existingClosingRow) : null;

  // 5. Detect late-entered transactions if already finalized
  let hasLateTransactions = false;
  let lateTransactionCount = 0;
  let lateTransactionDelta = 0;

  if (existingClosing && existingClosing.status === "FINALIZED" && existingClosing.snapshotData) {
    try {
      const snap = JSON.parse(existingClosing.snapshotData);
      const snapTxIds = new Set<string>(snap.transactionIds || []);
      const currentLiveTxIds = activeTxList.map((t) => t.id);

      const lateTxList = currentLiveTxIds.filter((id) => !snapTxIds.has(id));
      if (lateTxList.length > 0 || currentLiveTxIds.length !== snapTxIds.size) {
        hasLateTransactions = true;
        lateTransactionCount = lateTxList.length;
        const snapExpectedBal = Number(snap.expectedClosingBalance || 0);
        lateTransactionDelta = expectedClosingBalance - snapExpectedBal;
      }
    } catch {
      // Ignore json parse failures
    }
  }

  return {
    closingDate,
    division,
    openingBalance,
    openingCashBalance,
    channelBreakdown,
    totalInflow,
    totalOutflow,
    netMovement,
    expectedClosingBalance,
    expectedCashBalance,
    existingClosing,
    hasLateTransactions,
    lateTransactionCount,
    lateTransactionDelta,
    deliverySummary,
    transactions: activeTxList,
  };
}

/**
 * Saves or updates a daily closing in DRAFT status.
 * Requires finance.manage permission.
 */
export async function saveDailyClosingDraft(
  actor: AuthenticatedUser,
  input: SaveDailyClosingDraftInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DailyClosingRecord> {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.daily_closing_draft_saved" });

  const division: ClosingDivision = input.division || "COMBINED";
  const closingDate = input.closingDate;

  if (!closingDate || !DATE_REGEX.test(closingDate)) {
    throw new Error("Invalid closingDate format. Expected YYYY-MM-DD.");
  }

  const db = asyncDb ?? getAsyncDb();
  const preview = await previewDailyClosing(actor, closingDate, division, db);

  if (preview.existingClosing && preview.existingClosing.status === "FINALIZED") {
    throw new Error(`Daily closing for ${closingDate} (${division}) is FINALIZED and locked. It must be reopened by an authorized manager before updating.`);
  }

  const actualCash = input.actualCashCounted !== undefined && input.actualCashCounted !== null ? Number(input.actualCashCounted) : null;
  const actualBank = input.actualBankVerified !== undefined && input.actualBankVerified !== null ? Number(input.actualBankVerified) : null;
  const actualTotal = actualCash !== null && actualBank !== null ? actualCash + actualBank : (input.actualTotalBalance !== undefined && input.actualTotalBalance !== null ? Number(input.actualTotalBalance) : null);

  const cashDiscrepancy = actualCash !== null ? actualCash - preview.expectedCashBalance : 0;
  const totalDiscrepancy = actualTotal !== null ? actualTotal - preview.expectedClosingBalance : 0;

  const now = new Date().toISOString();
  let closingRecordId = preview.existingClosing?.id;

  await db.transaction(async (tx) => {
    if (preview.existingClosing) {
      await tx.execute(`
        UPDATE daily_cashbook_closings
        SET
          opening_balance = ?,
          opening_cash_balance = ?,
          cash_inflow = ?,
          upi_inflow = ?,
          bank_transfer_inflow = ?,
          cheque_inflow = ?,
          other_inflow = ?,
          cash_outflow = ?,
          upi_outflow = ?,
          bank_transfer_outflow = ?,
          cheque_outflow = ?,
          other_outflow = ?,
          total_inflow = ?,
          total_outflow = ?,
          expected_closing_balance = ?,
          expected_cash_balance = ?,
          actual_cash_counted = ?,
          actual_bank_verified = ?,
          actual_total_balance = ?,
          cash_discrepancy = ?,
          total_discrepancy = ?,
          discrepancy_reason = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `, [
        preview.openingBalance,
        preview.openingCashBalance,
        preview.channelBreakdown.CASH.inflow,
        preview.channelBreakdown.UPI.inflow,
        preview.channelBreakdown.BANK_TRANSFER.inflow,
        preview.channelBreakdown.CHEQUE.inflow,
        preview.channelBreakdown.OTHER.inflow,
        preview.channelBreakdown.CASH.outflow,
        preview.channelBreakdown.UPI.outflow,
        preview.channelBreakdown.BANK_TRANSFER.outflow,
        preview.channelBreakdown.CHEQUE.outflow,
        preview.channelBreakdown.OTHER.outflow,
        preview.totalInflow,
        preview.totalOutflow,
        preview.expectedClosingBalance,
        preview.expectedCashBalance,
        actualCash,
        actualBank,
        actualTotal,
        cashDiscrepancy,
        totalDiscrepancy,
        input.discrepancyReason || null,
        input.notes || null,
        now,
        closingRecordId,
      ]);
    } else {
      closingRecordId = generateId("dcc");
      await tx.execute(`
        INSERT INTO daily_cashbook_closings (
          id, closing_date, division, opening_balance, opening_cash_balance,
          cash_inflow, upi_inflow, bank_transfer_inflow, cheque_inflow, other_inflow,
          cash_outflow, upi_outflow, bank_transfer_outflow, cheque_outflow, other_outflow,
          total_inflow, total_outflow, expected_closing_balance, expected_cash_balance,
          actual_cash_counted, actual_bank_verified, actual_total_balance,
          cash_discrepancy, total_discrepancy, discrepancy_reason,
          status, prepared_by, notes, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          'DRAFT', ?, ?, ?, ?
        )
      `, [
        closingRecordId,
        closingDate,
        division,
        preview.openingBalance,
        preview.openingCashBalance,
        preview.channelBreakdown.CASH.inflow,
        preview.channelBreakdown.UPI.inflow,
        preview.channelBreakdown.BANK_TRANSFER.inflow,
        preview.channelBreakdown.CHEQUE.inflow,
        preview.channelBreakdown.OTHER.inflow,
        preview.channelBreakdown.CASH.outflow,
        preview.channelBreakdown.UPI.outflow,
        preview.channelBreakdown.BANK_TRANSFER.outflow,
        preview.channelBreakdown.CHEQUE.outflow,
        preview.channelBreakdown.OTHER.outflow,
        preview.totalInflow,
        preview.totalOutflow,
        preview.expectedClosingBalance,
        preview.expectedCashBalance,
        actualCash,
        actualBank,
        actualTotal,
        cashDiscrepancy,
        totalDiscrepancy,
        input.discrepancyReason || null,
        actor.id,
        input.notes || null,
        now,
        now,
      ]);
    }
  });

  return (await getDailyClosingById(actor, closingRecordId!, db))!;
}

/**
 * Finalizes and atomically locks a daily cashbook closing.
 * Mandates discrepancy explanation if variance != 0.
 * Records immutable snapshot of all transactions and channel totals.
 * Requires finance.manage permission.
 */
export async function finalizeDailyClosing(
  actor: AuthenticatedUser,
  input: FinalizeDailyClosingInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DailyClosingRecord> {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.daily_closing_finalized" });

  const division: ClosingDivision = input.division || "COMBINED";
  const closingDate = input.closingDate;

  if (!closingDate || !DATE_REGEX.test(closingDate)) {
    throw new Error("Invalid closingDate format. Expected YYYY-MM-DD.");
  }

  if (input.actualCashCounted === undefined || input.actualCashCounted === null || isNaN(Number(input.actualCashCounted))) {
    throw new Error("Actual counted cash figure is mandatory to finalize daily closing.");
  }

  const actualCash = Math.round(Number(input.actualCashCounted));
  if (actualCash < 0) {
    throw new Error("Actual cash counted cannot be negative.");
  }

  const actualBank = input.actualBankVerified !== undefined && input.actualBankVerified !== null
    ? Math.round(Number(input.actualBankVerified))
    : null;

  const db = asyncDb ?? getAsyncDb();
  let closingId: string | undefined;

  await db.transaction(async (tx) => {
    // 1. Acquire PostgreSQL transactional advisory exclusive lock on this closing date/division
    await acquireClosingExclusiveLock(tx, closingDate, division);

    // 2. Row-level check with FOR UPDATE on PostgreSQL
    const forUpdate = tx.isPostgres ? " FOR UPDATE" : "";
    const existingClosingRow = await tx.queryOne<any>(`
      SELECT id, status, division
      FROM daily_cashbook_closings
      WHERE closing_date = ? AND division = ?${forUpdate}
    `, [closingDate, division]);

    if (existingClosingRow && existingClosingRow.status === "FINALIZED") {
      throw new Error(`Daily closing for ${closingDate} (${division}) is already FINALIZED and locked.`);
    }

    // 3. Compute authoritative preview INSIDE transaction boundary
    const preview = await previewDailyClosing(actor, closingDate, division, tx);

    const cashDiscrepancy = actualCash - preview.expectedCashBalance;
    const actualTotal = actualBank !== null ? actualCash + actualBank : actualCash;
    const totalDiscrepancy = actualBank !== null ? actualTotal - preview.expectedClosingBalance : cashDiscrepancy;

    // Strict discrepancy justification check
    if (cashDiscrepancy !== 0 || (actualBank !== null && totalDiscrepancy !== 0)) {
      const reason = input.discrepancyReason?.trim();
      if (!reason || reason.length < 5) {
        throw new Error(
          `A clear discrepancy justification of at least 5 characters is mandatory when closing with a variance (Cash discrepancy: ₹${cashDiscrepancy}).`
        );
      }
    }

    const now = new Date().toISOString();
    closingId = existingClosingRow?.id;

    // Snapshot data for late-entry detection
    const snapshotData = JSON.stringify({
      finalizedAt: now,
      finalizedBy: actor.id,
      closingDate,
      division,
      openingBalance: preview.openingBalance,
      openingCashBalance: preview.openingCashBalance,
      totalInflow: preview.totalInflow,
      totalOutflow: preview.totalOutflow,
      expectedClosingBalance: preview.expectedClosingBalance,
      expectedCashBalance: preview.expectedCashBalance,
      actualCashCounted: actualCash,
      actualBankVerified: actualBank,
      cashDiscrepancy,
      totalDiscrepancy,
      channelBreakdown: preview.channelBreakdown,
      transactionCount: preview.transactions.length,
      transactionIds: preview.transactions.map((t) => t.id),
    });

    if (existingClosingRow) {
      const updateRes = await tx.execute(`
        UPDATE daily_cashbook_closings
        SET
          opening_balance = ?,
          opening_cash_balance = ?,
          cash_inflow = ?,
          upi_inflow = ?,
          bank_transfer_inflow = ?,
          cheque_inflow = ?,
          other_inflow = ?,
          cash_outflow = ?,
          upi_outflow = ?,
          bank_transfer_outflow = ?,
          cheque_outflow = ?,
          other_outflow = ?,
          total_inflow = ?,
          total_outflow = ?,
          expected_closing_balance = ?,
          expected_cash_balance = ?,
          actual_cash_counted = ?,
          actual_bank_verified = ?,
          actual_total_balance = ?,
          cash_discrepancy = ?,
          total_discrepancy = ?,
          discrepancy_reason = ?,
          status = 'FINALIZED',
          finalized_by = ?,
          finalized_at = ?,
          notes = ?,
          snapshot_data = ?,
          updated_at = ?
        WHERE id = ? AND status != 'FINALIZED'
      `, [
        preview.openingBalance,
        preview.openingCashBalance,
        preview.channelBreakdown.CASH.inflow,
        preview.channelBreakdown.UPI.inflow,
        preview.channelBreakdown.BANK_TRANSFER.inflow,
        preview.channelBreakdown.CHEQUE.inflow,
        preview.channelBreakdown.OTHER.inflow,
        preview.channelBreakdown.CASH.outflow,
        preview.channelBreakdown.UPI.outflow,
        preview.channelBreakdown.BANK_TRANSFER.outflow,
        preview.channelBreakdown.CHEQUE.outflow,
        preview.channelBreakdown.OTHER.outflow,
        preview.totalInflow,
        preview.totalOutflow,
        preview.expectedClosingBalance,
        preview.expectedCashBalance,
        actualCash,
        actualBank,
        actualTotal,
        cashDiscrepancy,
        totalDiscrepancy,
        input.discrepancyReason || null,
        actor.id,
        now,
        input.notes || null,
        snapshotData,
        now,
        closingId,
      ]);

      if (updateRes.changes === 0) {
        throw new Error(`Daily closing for ${closingDate} (${division}) was finalized concurrently by another session.`);
      }
    } else {
      closingId = generateId("dcc");
      await tx.execute(`
        INSERT INTO daily_cashbook_closings (
          id, closing_date, division, opening_balance, opening_cash_balance,
          cash_inflow, upi_inflow, bank_transfer_inflow, cheque_inflow, other_inflow,
          cash_outflow, upi_outflow, bank_transfer_outflow, cheque_outflow, other_outflow,
          total_inflow, total_outflow, expected_closing_balance, expected_cash_balance,
          actual_cash_counted, actual_bank_verified, actual_total_balance,
          cash_discrepancy, total_discrepancy, discrepancy_reason,
          status, prepared_by, finalized_by, finalized_at, notes, snapshot_data,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          'FINALIZED', ?, ?, ?, ?, ?,
          ?, ?
        )
      `, [
        closingId,
        closingDate,
        division,
        preview.openingBalance,
        preview.openingCashBalance,
        preview.channelBreakdown.CASH.inflow,
        preview.channelBreakdown.UPI.inflow,
        preview.channelBreakdown.BANK_TRANSFER.inflow,
        preview.channelBreakdown.CHEQUE.inflow,
        preview.channelBreakdown.OTHER.inflow,
        preview.channelBreakdown.CASH.outflow,
        preview.channelBreakdown.UPI.outflow,
        preview.channelBreakdown.BANK_TRANSFER.outflow,
        preview.channelBreakdown.CHEQUE.outflow,
        preview.channelBreakdown.OTHER.outflow,
        preview.totalInflow,
        preview.totalOutflow,
        preview.expectedClosingBalance,
        preview.expectedCashBalance,
        actualCash,
        actualBank,
        actualTotal,
        cashDiscrepancy,
        totalDiscrepancy,
        input.discrepancyReason || null,
        actor.id,
        actor.id,
        now,
        input.notes || null,
        snapshotData,
        now,
        now,
      ]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.daily_closing_finalized",
      targetType: "daily_cashbook_closing",
      targetId: closingId!,
      metadata: {
        closingDate,
        division,
        expectedCashBalance: preview.expectedCashBalance,
        actualCashCounted: actualCash,
        cashDiscrepancy,
        totalDiscrepancy,
        discrepancyReason: input.discrepancyReason || null,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getDailyClosingById(actor, closingId!, db))!;
}

/**
 * Reopens a finalized daily closing.
 * Strict governance: Only SUPER_ADMIN or OPERATIONS_MANAGER with finance.manage.
 * Requires mandatory justification reason of at least 5 characters.
 */
export async function reopenDailyClosing(
  actor: AuthenticatedUser,
  input: ReopenDailyClosingInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DailyClosingRecord> {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.daily_closing_reopened" });

  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ACCOUNTANT") {
    throw new AuthorizationError(403, "Only SUPER_ADMIN or ACCOUNTANT can reopen a finalized daily closing.");
  }

  const reason = input.reason?.trim();
  if (!reason || reason.length < 5) {
    throw new Error("A clear justification of at least 5 characters is mandatory to reopen a finalized daily closing.");
  }

  const db = asyncDb ?? getAsyncDb();
  const closingRow = await db.queryOne<any>(`SELECT * FROM daily_cashbook_closings WHERE id = ?`, [input.closingId]);
  if (!closingRow) {
    throw new Error(`Daily closing record '${input.closingId}' not found.`);
  }

  if (closingRow.status !== "FINALIZED") {
    throw new Error(`Daily closing record '${input.closingId}' is not finalized (status: ${closingRow.status}).`);
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE daily_cashbook_closings
      SET
        status = 'REOPENED',
        reopened_by = ?,
        reopened_at = ?,
        reopen_reason = ?,
        updated_at = ?
      WHERE id = ?
    `, [
      actor.id,
      now,
      reason,
      now,
      input.closingId,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.daily_closing_reopened",
      targetType: "daily_cashbook_closing",
      targetId: input.closingId,
      metadata: {
        closingDate: closingRow.closing_date,
        division: closingRow.division,
        reopenReason: reason,
      },
      ipAddress: clientIp,
    });
  });

  return (await getDailyClosingById(actor, input.closingId, db))!;
}

/**
 * Fetches a single daily closing record by ID.
 * Requires finance.read permission.
 */
export async function getDailyClosingById(
  actor: AuthenticatedUser,
  id: string,
  asyncDb?: AsyncDb
): Promise<DailyClosingRecord | null> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
  const row = await db.queryOne<any>(`
    SELECT
      dcc.*,
      p.full_name as prepared_by_name,
      f.full_name as finalized_by_name,
      r.full_name as reopened_by_name
    FROM daily_cashbook_closings dcc
    LEFT JOIN staff_users p ON dcc.prepared_by = p.id
    LEFT JOIN staff_users f ON dcc.finalized_by = f.id
    LEFT JOIN staff_users r ON dcc.reopened_by = r.id
    WHERE dcc.id = ?
  `, [id]);

  return row ? mapRowToClosingRecord(row) : null;
}

/**
 * Lists historical daily closing records with flexible filtering.
 * Requires finance.read permission.
 */
export async function listDailyClosings(
  actor: AuthenticatedUser,
  filters?: ListDailyClosingsFilter,
  asyncDb?: AsyncDb
): Promise<DailyClosingRecord[]> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.startDate && DATE_REGEX.test(filters.startDate)) {
    conditions.push("dcc.closing_date >= ?");
    params.push(filters.startDate);
  }
  if (filters?.endDate && DATE_REGEX.test(filters.endDate)) {
    conditions.push("dcc.closing_date <= ?");
    params.push(filters.endDate);
  }
  if (filters?.division) {
    conditions.push("dcc.division = ?");
    params.push(filters.division);
  }
  if (filters?.status) {
    conditions.push("dcc.status = ?");
    params.push(filters.status);
  }
  if (filters?.hasDiscrepancy === true) {
    conditions.push("(dcc.cash_discrepancy != 0 OR dcc.total_discrepancy != 0)");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db.query<any>(`
    SELECT
      dcc.*,
      p.full_name as prepared_by_name,
      f.full_name as finalized_by_name,
      r.full_name as reopened_by_name
    FROM daily_cashbook_closings dcc
    LEFT JOIN staff_users p ON dcc.prepared_by = p.id
    LEFT JOIN staff_users f ON dcc.finalized_by = f.id
    LEFT JOIN staff_users r ON dcc.reopened_by = r.id
    ${whereClause}
    ORDER BY dcc.closing_date DESC, dcc.created_at DESC
  `, params);

  return rows.map(mapRowToClosingRecord);
}
