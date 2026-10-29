import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized } from "../finance/financeService";
import {
  AuthenticatedUser,
  ResidentSettlementPreview,
  FinalizeSettlementInput,
  ResidentSettlementRecord,
  ResidentSettlementDeduction,
  PaymentMethod,
  normalizePaymentMethod,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function generateId(prefix: string): string {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Calculates a live preview of resident checkout settlement:
 * Outstanding rent, security deposit held, eligible deductions, suggested deposit application,
 * and refundable balance.
 * Requires residents.read or finance.read.
 */
export async function previewResidentSettlement(
  actor: AuthenticatedUser,
  residentId: string,
  checkOutDate?: string,
  asyncDb?: AsyncDb
): Promise<ResidentSettlementPreview> {
  const canReadResidents = hasPermission(actor.role, "residents.read");
  const canReadFinance = hasPermission(actor.role, "finance.read");
  if (!canReadResidents && !canReadFinance) {
    throw new AuthorizationError(
      403,
      `Role '${actor.role}' lacks permission to preview resident settlement. Requires 'residents.read' or 'finance.read'.`
    );
  }

  const db = asyncDb ?? getAsyncDb();
  const trimmedResidentId = residentId?.trim();
  if (!trimmedResidentId) {
    throw new Error("Resident ID is required.");
  }

  // 1. Fetch active stay and resident details
  const activeStay = await db.queryOne<{
    id: string;
    roomId: string;
    roomNumber: string;
    checkInDate: string;
    monthlyRent: number;
    securityDeposit: number;
    residentName: string;
  }>(`
    SELECT
      s.id,
      s.room_id as "roomId",
      rm.room_number as "roomNumber",
      s.check_in_date as "checkInDate",
      s.monthly_rent as "monthlyRent",
      s.security_deposit as "securityDeposit",
      r.full_name as "residentName"
    FROM resident_stays s
    JOIN residents r ON r.id = s.resident_id
    JOIN rooms rm ON rm.id = s.room_id
    WHERE s.resident_id = ? AND s.status = 'ACTIVE'
  `, [trimmedResidentId]);

  if (!activeStay) {
    throw new Error("Resident has no active room assignment to check out.");
  }

  const effectiveCheckOutDate = checkOutDate?.trim() || new Date().toISOString().slice(0, 10);
  if (!DATE_REGEX.test(effectiveCheckOutDate)) {
    throw new Error("Valid check-out date in YYYY-MM-DD format is required.");
  }

  if (effectiveCheckOutDate < activeStay.checkInDate) {
    throw new Error(
      `Check-out date (${effectiveCheckOutDate}) cannot be earlier than check-in date (${activeStay.checkInDate}).`
    );
  }

  // 2. Fetch live financial summary from financial_transactions
  const finTotals = await db.queryOne<{
    totalCharges: number | string;
    totalPayments: number | string;
    totalDeposits: number | string;
    priorRefunds: number | string;
  }>(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalCharges",
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalPayments",
      COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalDeposits",
      COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT_REFUND' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "priorRefunds"
    FROM financial_transactions
    WHERE resident_id = ? AND (stay_id = ? OR stay_id IS NULL)
  `, [trimmedResidentId, activeStay.id]);

  const totalRentCharged = Number(finTotals?.totalCharges || 0);
  const totalRentPaid = Number(finTotals?.totalPayments || 0);
  const totalDeposits = Number(finTotals?.totalDeposits || 0);
  const priorRefunds = Number(finTotals?.priorRefunds || 0);

  const outstandingRentDue = Math.max(0, totalRentCharged - totalRentPaid);
  const totalDepositHeld = Math.max(0, totalDeposits - priorRefunds);
  const refundableDepositAvailable = totalDepositHeld;

  // Defaults: apply deposit to clear outstanding rent up to available deposit
  const suggestedDepositApplied = Math.min(outstandingRentDue, refundableDepositAvailable);
  const suggestedRefund = Math.max(0, refundableDepositAvailable - suggestedDepositApplied);
  const suggestedRemainingPayable = Math.max(0, outstandingRentDue - suggestedDepositApplied);

  return {
    residentId: trimmedResidentId,
    residentName: activeStay.residentName,
    stayId: activeStay.id,
    roomId: activeStay.roomId,
    roomNumber: activeStay.roomNumber,
    checkInDate: activeStay.checkInDate,
    checkOutDate: effectiveCheckOutDate,
    monthlyRent: Number(activeStay.monthlyRent || 0),
    totalRentCharged,
    totalRentPaid,
    outstandingRentDue,
    totalDepositHeld,
    priorRefunds,
    refundableDepositAvailable,
    suggestedDepositApplied,
    suggestedRefund,
    suggestedRemainingPayable,
  };
}

/**
 * Finalizes resident checkout and final financial settlement:
 * Validates deductions, creates deposit application and refund transactions,
 * records final rent payment if paid, creates immutable settlement record,
 * marks stay COMPLETED, marks resident CHECKED_OUT, releases room capacity,
 * and creates an auditable history.
 * Requires residents.manage or finance.manage.
 */
export async function finalizeResidentCheckoutSettlement(
  actor: AuthenticatedUser,
  input: FinalizeSettlementInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<ResidentSettlementRecord> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = typeof clientIpOrDb === "object" && clientIpOrDb !== null ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  // 1. Authorization: least-privilege verification
  const canManageResidents = hasPermission(actor.role, "residents.manage");
  const canManageFinance = hasPermission(actor.role, "finance.manage");
  if (!canManageResidents && !canManageFinance) {
    throw new AuthorizationError(
      403,
      `Role '${actor.role}' lacks permission to finalize resident checkout settlement. Requires 'residents.manage' or 'finance.manage'.`
    );
  }

  // 2. Validate input fields
  const residentId = input.residentId?.trim();
  if (!residentId) throw new Error("Resident ID is required.");

  const checkOutDate = input.checkOutDate?.trim();
  if (!checkOutDate || !DATE_REGEX.test(checkOutDate)) {
    throw new Error("Valid check-out date in YYYY-MM-DD format is required.");
  }

  // Deductions validation
  const rawDeductions = Array.isArray(input.deductions) ? input.deductions : [];
  const deductions: ResidentSettlementDeduction[] = [];
  let totalDeductions = 0;

  for (const item of rawDeductions) {
    const reason = item.reason?.trim();
    const amount = Number(item.amount);
    if (!reason) {
      throw new Error("Every deduction must have a documented reason.");
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Deduction amount for '${reason}' must be a positive integer.`);
    }
    deductions.push({ reason, amount });
    totalDeductions += amount;
  }

  const depositAppliedAmount = Math.max(0, Number(input.depositAppliedAmount) || 0);
  const refundAmount = Math.max(0, Number(input.refundAmount) || 0);

  if (!Number.isInteger(depositAppliedAmount) || depositAppliedAmount < 0) {
    throw new Error("Deposit applied amount must be a non-negative integer.");
  }
  if (!Number.isInteger(refundAmount) || refundAmount < 0) {
    throw new Error("Refund amount must be a non-negative integer.");
  }

  let canonicalRefundMethod: PaymentMethod | null = null;
  if (refundAmount > 0) {
    if (!input.refundPaymentMethod) {
      throw new Error("Payment method is required when recording a deposit refund.");
    }
    canonicalRefundMethod = normalizePaymentMethod(input.refundPaymentMethod);
  }

  let canonicalPaymentMethod: PaymentMethod | null = null;
  if (input.paymentMethod) {
    canonicalPaymentMethod = normalizePaymentMethod(input.paymentMethod);
  }

  // 3. Atomic Database Transaction
  return await db.transaction(async (tx) => {
    // Closing lock guard: verify checkout date is not locked by finalized cashbook closing
    await assertClosingDateNotFinalized(tx, checkOutDate, "PG");

    // A. Re-verify active stay under transaction
    const activeStay = await tx.queryOne<{
      id: string;
      roomId: string;
      roomNumber: string;
      checkInDate: string;
      monthlyRent: number;
      residentName: string;
    }>(`
      SELECT
        s.id,
        s.room_id as "roomId",
        rm.room_number as "roomNumber",
        s.check_in_date as "checkInDate",
        s.monthly_rent as "monthlyRent",
        r.full_name as "residentName"
      FROM resident_stays s
      JOIN residents r ON r.id = s.resident_id
      JOIN rooms rm ON rm.id = s.room_id
      WHERE s.resident_id = ? AND s.status = 'ACTIVE'
    `, [residentId]);

    if (!activeStay) {
      throw new Error("Resident has no active room assignment to check out.");
    }

    if (checkOutDate < activeStay.checkInDate) {
      throw new Error(
        `Check-out date (${checkOutDate}) cannot be earlier than check-in date (${activeStay.checkInDate}).`
      );
    }

    // B. Concurrency check: Ensure no settlement already exists for this stay
    const existingSettlement = await tx.queryOne<{ id: string }>(`
      SELECT id FROM resident_settlements WHERE stay_id = ?
    `, [activeStay.id]);

    if (existingSettlement) {
      throw new Error(`Settlement has already been finalized for stay '${activeStay.id}'.`);
    }

    // C. Live balance recalculation on current committed records
    const finTotals = await tx.queryOne<{
      totalCharges: number | string;
      totalPayments: number | string;
      totalDeposits: number | string;
      priorRefunds: number | string;
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalCharges",
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalPayments",
        COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalDeposits",
        COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT_REFUND' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "priorRefunds"
      FROM financial_transactions
      WHERE resident_id = ? AND (stay_id = ? OR stay_id IS NULL)
    `, [residentId, activeStay.id]);

    const liveTotalRentCharged = Number(finTotals?.totalCharges || 0);
    const liveTotalRentPaid = Number(finTotals?.totalPayments || 0);
    const liveTotalDeposits = Number(finTotals?.totalDeposits || 0);
    const livePriorRefunds = Number(finTotals?.priorRefunds || 0);

    const liveOutstandingRent = Math.max(0, liveTotalRentCharged - liveTotalRentPaid);
    const liveDepositHeld = Math.max(0, liveTotalDeposits - livePriorRefunds);

    // Validate calculations against live data
    if (totalDeductions > liveDepositHeld) {
      throw new Error(
        `Total deductions (₹${totalDeductions.toLocaleString("en-IN")}) cannot exceed available security deposit held (₹${liveDepositHeld.toLocaleString("en-IN")}).`
      );
    }

    const availableDeposit = liveDepositHeld - totalDeductions;

    if (depositAppliedAmount > availableDeposit) {
      throw new Error(
        `Deposit applied (₹${depositAppliedAmount.toLocaleString("en-IN")}) cannot exceed available refundable deposit after deductions (₹${availableDeposit.toLocaleString("en-IN")}).`
      );
    }

    if (depositAppliedAmount > liveOutstandingRent) {
      throw new Error(
        `Deposit applied (₹${depositAppliedAmount.toLocaleString("en-IN")}) cannot exceed outstanding rent balance (₹${liveOutstandingRent.toLocaleString("en-IN")}).`
      );
    }

    const remainingRefundableDeposit = availableDeposit - depositAppliedAmount;
    if (refundAmount > remainingRefundableDeposit) {
      throw new Error(
        `Refund amount (₹${refundAmount.toLocaleString("en-IN")}) cannot exceed remaining refundable deposit (₹${remainingRefundableDeposit.toLocaleString("en-IN")}).`
      );
    }

    const now = new Date().toISOString();

    // D. Record Deposit Application to rent (if depositAppliedAmount > 0)
    let depositAppliedTxId: string | null = null;
    if (depositAppliedAmount > 0) {
      depositAppliedTxId = generateId("fin_dep_app");
      await tx.execute(`
        INSERT INTO financial_transactions (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, stay_id, category,
          description, idempotency_key, status, created_by, created_at, updated_at
        ) VALUES (?, 'RENT_PAYMENT', ?, ?, 'OTHER', ?, ?, ?, 'DEPOSIT_APPLICATION', ?, ?, 'POSTED', ?, ?, ?)
      `, [
        depositAppliedTxId,
        depositAppliedAmount,
        checkOutDate,
        `DEP-APP-${activeStay.id}`,
        residentId,
        activeStay.id,
        `Security deposit applied against outstanding rent upon checkout for Stay ${activeStay.id}`,
        `dep_app_${activeStay.id}`,
        actor.id,
        now,
        now,
      ]);
    }

    // E. Record Deposit Refund (if refundAmount > 0)
    let refundTxId: string | null = null;
    if (refundAmount > 0) {
      refundTxId = generateId("fin_ref");
      await tx.execute(`
        INSERT INTO financial_transactions (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, stay_id, category,
          description, idempotency_key, status, created_by, created_at, updated_at
        ) VALUES (?, 'DEPOSIT_REFUND', ?, ?, ?, ?, ?, ?, 'SECURITY_DEPOSIT_REFUND', ?, ?, 'POSTED', ?, ?, ?)
      `, [
        refundTxId,
        refundAmount,
        checkOutDate,
        canonicalRefundMethod,
        input.refundReference?.trim() || `REF-${activeStay.id}`,
        residentId,
        activeStay.id,
        `Security deposit refund upon checkout for Stay ${activeStay.id}`,
        `dep_ref_${activeStay.id}`,
        actor.id,
        now,
        now,
      ]);
    }

    // F. Final rent payment at checkout (if resident pays remaining balance now)
    const remainingBalanceBeforePayment = liveOutstandingRent - depositAppliedAmount;
    let paymentTxId: string | null = null;
    let actualPaidNow = 0;

    if (remainingBalanceBeforePayment > 0 && canonicalPaymentMethod) {
      const requestedPaymentAmount = Number(input.remainingPayableAmount);
      actualPaidNow = Number.isInteger(requestedPaymentAmount) && requestedPaymentAmount > 0
        ? Math.min(remainingBalanceBeforePayment, requestedPaymentAmount)
        : remainingBalanceBeforePayment;

      if (actualPaidNow > 0) {
        paymentTxId = generateId("fin_final_pay");
        await tx.execute(`
          INSERT INTO financial_transactions (
            id, transaction_type, amount, transaction_date, payment_method,
            reference_number, resident_id, stay_id, category,
            description, idempotency_key, status, created_by, created_at, updated_at
          ) VALUES (?, 'RENT_PAYMENT', ?, ?, ?, ?, ?, ?, 'RENT_PAYMENT', ?, ?, 'POSTED', ?, ?, ?)
        `, [
          paymentTxId,
          actualPaidNow,
          checkOutDate,
          canonicalPaymentMethod,
          input.paymentReference?.trim() || `FINAL-RENT-${activeStay.id}`,
          residentId,
          activeStay.id,
          `Final rent payment upon checkout for Stay ${activeStay.id}`,
          `final_pay_${activeStay.id}`,
          actor.id,
          now,
          now,
        ]);
      }
    }

    const finalRemainingPayable = remainingBalanceBeforePayment - actualPaidNow;
    const settlementStatus: "SETTLED" | "PENDING_PAYMENT" =
      finalRemainingPayable > 0 ? "PENDING_PAYMENT" : "SETTLED";

    // G. Insert immutable resident_settlements record
    const settlementId = generateId("stl");
    const deductionsBreakdownJson = deductions.length > 0 ? JSON.stringify(deductions) : null;

    await tx.execute(`
      INSERT INTO resident_settlements (
        id, resident_id, stay_id, room_id, checkout_date,
        outstanding_rent_amount, deposit_held_amount, deductions_amount, deductions_breakdown,
        deposit_applied_amount, refund_amount, refund_payment_method, refund_transaction_id,
        remaining_payable_amount, payment_transaction_id, settlement_status, notes,
        settled_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      settId(settlementId),
      residentId,
      activeStay.id,
      activeStay.roomId,
      checkOutDate,
      liveOutstandingRent,
      liveDepositHeld,
      totalDeductions,
      deductionsBreakdownJson,
      depositAppliedAmount,
      refundAmount,
      canonicalRefundMethod,
      refundTxId,
      finalRemainingPayable,
      paymentTxId,
      settlementStatus,
      input.notes?.trim() || null,
      actor.id,
      now,
      now,
    ]);

    // H. Complete resident stay & immediately release room capacity
    await tx.execute(`
      UPDATE resident_stays
      SET status = 'COMPLETED', check_out_date = ?, updated_at = ?
      WHERE id = ?
    `, [checkOutDate, now, activeStay.id]);

    // I. Update resident status
    await tx.execute(`
      UPDATE residents
      SET status = 'CHECKED_OUT', updated_at = ?
      WHERE id = ?
    `, [now, residentId]);

    // J. Audit log entry
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "resident.checkout_settled",
      targetType: "resident",
      targetId: residentId,
      metadata: {
        settlementId,
        stayId: activeStay.id,
        roomId: activeStay.roomId,
        roomNumber: activeStay.roomNumber,
        checkoutDate: checkOutDate,
        outstandingRentAmount: liveOutstandingRent,
        depositHeldAmount: liveDepositHeld,
        deductionsAmount: totalDeductions,
        deductionsBreakdown: deductions,
        depositAppliedAmount,
        refundAmount,
        refundPaymentMethod: canonicalRefundMethod,
        refundTransactionId: refundTxId,
        remainingPayableAmount: finalRemainingPayable,
        paymentTransactionId: paymentTxId,
        settlementStatus,
      },
      ipAddress: clientIp,
    }, tx);

    return {
      id: settlementId,
      residentId,
      stayId: activeStay.id,
      roomId: activeStay.roomId,
      roomNumber: activeStay.roomNumber,
      checkoutDate: checkOutDate,
      outstandingRentAmount: liveOutstandingRent,
      depositHeldAmount: liveDepositHeld,
      deductionsAmount: totalDeductions,
      deductionsBreakdown: deductions.length > 0 ? deductions : null,
      depositAppliedAmount,
      refundAmount,
      refundPaymentMethod: canonicalRefundMethod,
      refundTransactionId: refundTxId,
      remainingPayableAmount: finalRemainingPayable,
      paymentTransactionId: paymentTxId,
      settlementStatus,
      notes: input.notes?.trim() || null,
      settledBy: actor.id,
      settledByName: actor.username,
      createdAt: now,
      updatedAt: now,
    };
  });
}

function settId(id: string): string {
  return id;
}

/**
 * Retrieves the settlement record for a specific stay.
 * Requires residents.read or finance.read.
 */
export async function getResidentSettlementByStayId(
  actor: AuthenticatedUser,
  stayId: string,
  asyncDb?: AsyncDb
): Promise<ResidentSettlementRecord | null> {
  const canReadResidents = hasPermission(actor.role, "residents.read");
  const canReadFinance = hasPermission(actor.role, "finance.read");
  if (!canReadResidents && !canReadFinance) {
    throw new AuthorizationError(
      403,
      `Role '${actor.role}' lacks permission to view resident settlement. Requires 'residents.read' or 'finance.read'.`
    );
  }

  const db = asyncDb ?? getAsyncDb();
  const row = await db.queryOne<any>(`
    SELECT
      s.*,
      rm.room_number as "roomNumber",
      u.username as "settledByName"
    FROM resident_settlements s
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN staff_users u ON u.id = s.settled_by
    WHERE s.stay_id = ?
  `, [stayId]);

  if (!row) return null;

  let deductionsBreakdown: ResidentSettlementDeduction[] | null = null;
  if (row.deductions_breakdown) {
    try {
      deductionsBreakdown = JSON.parse(row.deductions_breakdown);
    } catch {
      deductionsBreakdown = null;
    }
  }

  return {
    id: row.id,
    residentId: row.resident_id,
    stayId: row.stay_id,
    roomId: row.room_id,
    roomNumber: row.roomNumber || null,
    checkoutDate: row.checkout_date,
    outstandingRentAmount: Number(row.outstanding_rent_amount || 0),
    depositHeldAmount: Number(row.deposit_held_amount || 0),
    deductionsAmount: Number(row.deductions_amount || 0),
    deductionsBreakdown,
    depositAppliedAmount: Number(row.deposit_applied_amount || 0),
    refundAmount: Number(row.refund_amount || 0),
    refundPaymentMethod: row.refund_payment_method || null,
    refundTransactionId: row.refund_transaction_id || null,
    remainingPayableAmount: Number(row.remaining_payable_amount || 0),
    paymentTransactionId: row.payment_transaction_id || null,
    settlementStatus: row.settlement_status,
    notes: row.notes || null,
    settledBy: row.settled_by,
    settledByName: row.settledByName || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists all historical settlement records for a given resident.
 * Requires residents.read or finance.read.
 */
export async function listResidentSettlements(
  actor: AuthenticatedUser,
  residentId: string,
  asyncDb?: AsyncDb
): Promise<ResidentSettlementRecord[]> {
  const canReadResidents = hasPermission(actor.role, "residents.read");
  const canReadFinance = hasPermission(actor.role, "finance.read");
  if (!canReadResidents && !canReadFinance) {
    throw new AuthorizationError(
      403,
      `Role '${actor.role}' lacks permission to view resident settlements. Requires 'residents.read' or 'finance.read'.`
    );
  }

  const db = asyncDb ?? getAsyncDb();
  const rows = await db.query<any>(`
    SELECT
      s.*,
      rm.room_number as "roomNumber",
      u.username as "settledByName"
    FROM resident_settlements s
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN staff_users u ON u.id = s.settled_by
    WHERE s.resident_id = ?
    ORDER BY s.created_at DESC
  `, [residentId]);

  return rows.map((row) => {
    let deductionsBreakdown: ResidentSettlementDeduction[] | null = null;
    if (row.deductions_breakdown) {
      try {
        deductionsBreakdown = JSON.parse(row.deductions_breakdown);
      } catch {
        deductionsBreakdown = null;
      }
    }

    return {
      id: row.id,
      residentId: row.resident_id,
      stayId: row.stay_id,
      roomId: row.room_id,
      roomNumber: row.roomNumber || null,
      checkoutDate: row.checkout_date,
      outstandingRentAmount: Number(row.outstanding_rent_amount || 0),
      depositHeldAmount: Number(row.deposit_held_amount || 0),
      deductionsAmount: Number(row.deductions_amount || 0),
      deductionsBreakdown,
      depositAppliedAmount: Number(row.deposit_applied_amount || 0),
      refundAmount: Number(row.refund_amount || 0),
      refundPaymentMethod: row.refund_payment_method || null,
      refundTransactionId: row.refund_transaction_id || null,
      remainingPayableAmount: Number(row.remaining_payable_amount || 0),
      paymentTransactionId: row.payment_transaction_id || null,
      settlementStatus: row.settlement_status,
      notes: row.notes || null,
      settledBy: row.settled_by,
      settledByName: row.settledByName || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
