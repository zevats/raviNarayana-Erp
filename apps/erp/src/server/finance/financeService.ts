import crypto from "crypto";
import { getDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEvent } from "../audit/audit";
import {
  AuthenticatedUser,
  TransactionType,
  PaymentMethod,
  ExpenseCategory,
  TransactionStatus,
  FinancialTransaction,
  ResidentFinancialSummary,
  CashbookSummary,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = [
  "CASH",
  "UPI",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
];

const VALID_EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  "GROCERY",
  "UTILITIES",
  "MAINTENANCE",
  "STAFF_SALARY",
  "KITCHEN_SUPPLIES",
  "INTERNET",
  "MARKETING",
  "OTHER",
];

export interface RecordRentChargeInput {
  residentId: string;
  stayId?: string;
  amount: number;
  transactionDate: string;
  billingPeriod: string;
  description?: string;
  idempotencyKey?: string;
}

export interface RecordRentPaymentInput {
  residentId: string;
  stayId?: string;
  amount: number;
  transactionDate: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  description?: string;
  idempotencyKey?: string;
}

export interface RecordSecurityDepositInput {
  residentId: string;
  stayId?: string;
  amount: number;
  transactionDate: string;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  description?: string;
  idempotencyKey?: string;
}

export interface RecordExpenseInput {
  category: ExpenseCategory;
  amount: number;
  transactionDate: string;
  paymentMethod: PaymentMethod;
  payeeVendor?: string;
  description: string;
  referenceNumber?: string;
  idempotencyKey?: string;
}

export interface ListTransactionsOptions {
  type?: TransactionType;
  category?: string;
  residentId?: string;
  stayId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

function mapRowToTransaction(row: any): FinancialTransaction {
  return {
    id: row.id,
    transactionType: row.transaction_type as TransactionType,
    amount: Number(row.amount),
    transactionDate: row.transaction_date,
    paymentMethod: row.payment_method ? (row.payment_method as PaymentMethod) : null,
    referenceNumber: row.reference_number || null,
    residentId: row.resident_id || null,
    residentName: row.resident_name || null,
    stayId: row.stay_id || null,
    roomNumber: row.room_number || null,
    category: row.category,
    description: row.description || null,
    billingPeriod: row.billing_period || null,
    payeeVendor: row.payee_vendor || null,
    idempotencyKey: row.idempotency_key || null,
    status: row.status as TransactionStatus,
    reversalOfId: row.reversal_of_id || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Calculates a resident's current outstanding rent balance:
 * (Total POSTED Rent Charges) - (Total POSTED Rent Payments)
 */
export function getResidentRentBalance(residentId: string): number {
  const db = getDb();
  const res = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as charges,
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as payments
    FROM financial_transactions
    WHERE resident_id = ?
  `).get(residentId) as { charges: number; payments: number };

  return (res?.charges || 0) - (res?.payments || 0);
}

/**
 * Records an explicit rent charge for a resident & stay.
 * Requires finance.manage permission.
 */
export function recordRentCharge(
  actor: AuthenticatedUser,
  input: RecordRentChargeInput,
  clientIp?: string
): FinancialTransaction {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.rent_charge_recorded" });

  const residentId = input.residentId?.trim();
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const billingPeriod = input.billingPeriod?.trim();
  const description = input.description?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (!residentId) throw new Error("Resident ID is required.");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Rent charge amount must be a positive integer in INR.");
  }
  if (!transactionDate || !DATE_REGEX.test(transactionDate)) {
    throw new Error("Valid transaction date in YYYY-MM-DD format is required.");
  }
  if (!billingPeriod) {
    throw new Error("Billing period (e.g. 'October 2026') is required.");
  }

  const db = getDb();

  // Idempotency check: if already processed, return existing or reject mismatch
  if (idempotencyKey) {
    const existing = db.prepare("SELECT * FROM financial_transactions WHERE idempotency_key = ?").get(idempotencyKey) as any;
    if (existing) {
      if (
        existing.transaction_type !== "RENT_CHARGE" ||
        existing.amount !== amount ||
        existing.resident_id !== residentId ||
        (billingPeriod && existing.billing_period !== billingPeriod)
      ) {
        throw new Error(
          `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
        );
      }
      return mapRowToTransaction(existing);
    }
  }

  // Validate resident exists
  const resident = db.prepare("SELECT id, full_name as fullName FROM residents WHERE id = ?").get(residentId) as any;
  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  // Resolve stayId
  let stayId = input.stayId?.trim() || null;
  if (!stayId) {
    const activeStay = db.prepare("SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'").get(residentId) as any;
    if (activeStay) {
      stayId = activeStay.id;
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'RENT_CHARGE', ?, ?, NULL,
        NULL, ?, ?, 'RENT', ?,
        ?, NULL, ?, 'POSTED',
        NULL, ?, ?, ?
      )
    `).run(
      id,
      amount,
      transactionDate,
      residentId,
      stayId,
      description,
      billingPeriod,
      idempotencyKey,
      actor.id,
      now,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.rent_charge_recorded",
      targetType: "transaction",
      targetId: id,
      metadata: {
        residentId,
        residentName: resident.fullName,
        stayId,
        amount,
        transactionDate,
        billingPeriod,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getTransactionById(actor, id)!;
}

/**
 * Records a rent payment received from a resident.
 * Enforces that payment does not silently exceed outstanding rent balance.
 * Requires finance.manage permission.
 */
export function recordRentPayment(
  actor: AuthenticatedUser,
  input: RecordRentPaymentInput,
  clientIp?: string
): FinancialTransaction {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.rent_payment_recorded" });

  const residentId = input.residentId?.trim();
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = input.paymentMethod;
  const referenceNumber = input.referenceNumber?.trim() || null;
  const description = input.description?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (!residentId) throw new Error("Resident ID is required.");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Payment amount must be a positive integer in INR.");
  }
  if (!transactionDate || !DATE_REGEX.test(transactionDate)) {
    throw new Error("Valid transaction date in YYYY-MM-DD format is required.");
  }
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`Invalid payment method '${paymentMethod}'. Must be CASH, UPI, BANK_TRANSFER, CHEQUE, or OTHER.`);
  }

  const db = getDb();

  // Idempotency check: if already processed, return existing or reject mismatch
  if (idempotencyKey) {
    const existing = db.prepare("SELECT * FROM financial_transactions WHERE idempotency_key = ?").get(idempotencyKey) as any;
    if (existing) {
      if (
        existing.transaction_type !== "RENT_PAYMENT" ||
        existing.amount !== amount ||
        existing.resident_id !== residentId ||
        existing.payment_method !== paymentMethod
      ) {
        throw new Error(
          `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
        );
      }
      return mapRowToTransaction(existing);
    }
  }

  // Validate resident exists
  const resident = db.prepare("SELECT id, full_name as fullName FROM residents WHERE id = ?").get(residentId) as any;
  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  // Check outstanding rent balance
  const currentBalance = getResidentRentBalance(residentId);
  if (amount > currentBalance) {
    throw new Error(
      `Payment amount (₹${amount.toLocaleString("en-IN")}) exceeds current outstanding rent balance (₹${Math.max(0, currentBalance).toLocaleString("en-IN")}). Payments cannot exceed outstanding billed charges.`
    );
  }

  // Resolve stayId
  let stayId = input.stayId?.trim() || null;
  if (!stayId) {
    const activeStay = db.prepare("SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'").get(residentId) as any;
    if (activeStay) {
      stayId = activeStay.id;
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'RENT_PAYMENT', ?, ?, ?,
        ?, ?, ?, 'RENT', ?,
        NULL, NULL, ?, 'POSTED',
        NULL, ?, ?, ?
      )
    `).run(
      id,
      amount,
      transactionDate,
      paymentMethod,
      referenceNumber,
      residentId,
      stayId,
      description,
      idempotencyKey,
      actor.id,
      now,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.rent_payment_recorded",
      targetType: "transaction",
      targetId: id,
      metadata: {
        residentId,
        residentName: resident.fullName,
        stayId,
        amount,
        paymentMethod,
        referenceNumber,
        transactionDate,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getTransactionById(actor, id)!;
}

/**
 * Records a security deposit received.
 * Strictly classified as a held deposit liability, separate from rent revenue.
 * Requires finance.manage permission.
 */
export function recordSecurityDeposit(
  actor: AuthenticatedUser,
  input: RecordSecurityDepositInput,
  clientIp?: string
): FinancialTransaction {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.security_deposit_recorded" });

  const residentId = input.residentId?.trim();
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = input.paymentMethod;
  const referenceNumber = input.referenceNumber?.trim() || null;
  const description = input.description?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (!residentId) throw new Error("Resident ID is required.");
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Security deposit amount must be a positive integer in INR.");
  }
  if (!transactionDate || !DATE_REGEX.test(transactionDate)) {
    throw new Error("Valid transaction date in YYYY-MM-DD format is required.");
  }
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`Invalid payment method '${paymentMethod}'. Must be CASH, UPI, BANK_TRANSFER, CHEQUE, or OTHER.`);
  }

  const db = getDb();

  // Idempotency check: if already processed, return existing or reject mismatch
  if (idempotencyKey) {
    const existing = db.prepare("SELECT * FROM financial_transactions WHERE idempotency_key = ?").get(idempotencyKey) as any;
    if (existing) {
      if (
        existing.transaction_type !== "SECURITY_DEPOSIT" ||
        existing.amount !== amount ||
        existing.resident_id !== residentId ||
        existing.payment_method !== paymentMethod
      ) {
        throw new Error(
          `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
        );
      }
      return mapRowToTransaction(existing);
    }
  }

  const resident = db.prepare("SELECT id, full_name as fullName FROM residents WHERE id = ?").get(residentId) as any;
  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  let stayId = input.stayId?.trim() || null;
  if (!stayId) {
    const activeStay = db.prepare("SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'").get(residentId) as any;
    if (activeStay) {
      stayId = activeStay.id;
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'SECURITY_DEPOSIT', ?, ?, ?,
        ?, ?, ?, 'SECURITY_DEPOSIT', ?,
        NULL, NULL, ?, 'POSTED',
        NULL, ?, ?, ?
      )
    `).run(
      id,
      amount,
      transactionDate,
      paymentMethod,
      referenceNumber,
      residentId,
      stayId,
      description,
      idempotencyKey,
      actor.id,
      now,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.security_deposit_recorded",
      targetType: "transaction",
      targetId: id,
      metadata: {
        residentId,
        residentName: resident.fullName,
        stayId,
        amount,
        paymentMethod,
        referenceNumber,
        transactionDate,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getTransactionById(actor, id)!;
}

/**
 * Records an operational business expense.
 * Reduces cashbook net movement; does NOT affect resident rent balances.
 * Requires finance.manage permission.
 */
export function recordExpense(
  actor: AuthenticatedUser,
  input: RecordExpenseInput,
  clientIp?: string
): FinancialTransaction {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.expense_recorded" });

  const category = input.category;
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = input.paymentMethod;
  const payeeVendor = input.payeeVendor?.trim() || null;
  const description = input.description?.trim();
  const referenceNumber = input.referenceNumber?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (!VALID_EXPENSE_CATEGORIES.includes(category)) {
    throw new Error(`Invalid expense category '${category}'.`);
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Expense amount must be a positive integer in INR.");
  }
  if (!transactionDate || !DATE_REGEX.test(transactionDate)) {
    throw new Error("Valid transaction date in YYYY-MM-DD format is required.");
  }
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`Invalid payment method '${paymentMethod}'. Must be CASH, UPI, BANK_TRANSFER, CHEQUE, or OTHER.`);
  }
  if (!description || description.length < 3) {
    throw new Error("Expense description of at least 3 characters is required.");
  }

  const db = getDb();

  // Idempotency check: if already processed, return existing or reject mismatch
  if (idempotencyKey) {
    const existing = db.prepare("SELECT * FROM financial_transactions WHERE idempotency_key = ?").get(idempotencyKey) as any;
    if (existing) {
      if (
        existing.transaction_type !== "EXPENSE" ||
        existing.amount !== amount ||
        existing.category !== category ||
        existing.payment_method !== paymentMethod
      ) {
        throw new Error(
          `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
        );
      }
      return mapRowToTransaction(existing);
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'EXPENSE', ?, ?, ?,
        ?, NULL, NULL, ?, ?,
        NULL, ?, ?, 'POSTED',
        NULL, ?, ?, ?
      )
    `).run(
      id,
      amount,
      transactionDate,
      paymentMethod,
      referenceNumber,
      category,
      description,
      payeeVendor,
      idempotencyKey,
      actor.id,
      now,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.expense_recorded",
      targetType: "transaction",
      targetId: id,
      metadata: {
        category,
        amount,
        paymentMethod,
        payeeVendor,
        transactionDate,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getTransactionById(actor, id)!;
}

/**
 * Retrieves a single transaction by ID.
 * Requires finance.read permission.
 */
export function getTransactionById(
  actor: AuthenticatedUser,
  transactionId: string
): FinancialTransaction | null {
  requirePermission(actor, "finance.read");

  const db = getDb();
  const row = db.prepare(`
    SELECT
      t.*,
      r.full_name as resident_name,
      rm.room_number,
      u.full_name as created_by_name
    FROM financial_transactions t
    LEFT JOIN residents r ON r.id = t.resident_id
    LEFT JOIN resident_stays s ON s.id = t.stay_id
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN staff_users u ON u.id = t.created_by
    WHERE t.id = ?
  `).get(transactionId);

  if (!row) return null;
  return mapRowToTransaction(row);
}

/**
 * Lists financial transactions with flexible date, category, and type filters.
 * Requires finance.read permission.
 */
export function listTransactions(
  actor: AuthenticatedUser,
  options?: ListTransactionsOptions
): FinancialTransaction[] {
  requirePermission(actor, "finance.read");

  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.type) {
    conditions.push("t.transaction_type = ?");
    params.push(options.type);
  }
  if (options?.category) {
    conditions.push("t.category = ?");
    params.push(options.category);
  }
  if (options?.residentId) {
    conditions.push("t.resident_id = ?");
    params.push(options.residentId);
  }
  if (options?.stayId) {
    conditions.push("t.stay_id = ?");
    params.push(options.stayId);
  }
  if (options?.startDate) {
    conditions.push("t.transaction_date >= ?");
    params.push(options.startDate);
  }
  if (options?.endDate) {
    conditions.push("t.transaction_date <= ?");
    params.push(options.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 100));
  const offset = Math.max(0, Number(options?.offset) || 0);

  const rows = db.prepare(`
    SELECT
      t.*,
      r.full_name as resident_name,
      rm.room_number,
      u.full_name as created_by_name
    FROM financial_transactions t
    LEFT JOIN residents r ON r.id = t.resident_id
    LEFT JOIN resident_stays s ON s.id = t.stay_id
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN staff_users u ON u.id = t.created_by
    ${whereClause}
    ORDER BY t.transaction_date DESC, t.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return rows.map(mapRowToTransaction);
}

/**
 * Calculates resident financial dossier:
 * rent charges, payments, outstanding balance, deposits held, and ledger entries.
 * Requires finance.read permission.
 */
export function getResidentFinancialSummary(
  actor: AuthenticatedUser,
  residentId: string
): ResidentFinancialSummary {
  requirePermission(actor, "finance.read");

  const db = getDb();

  const resident = db.prepare(`
    SELECT r.id, r.full_name as fullName, r.phone, r.status, rm.room_number as currentRoomNumber
    FROM residents r
    LEFT JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
    LEFT JOIN rooms rm ON rm.id = s.room_id
    WHERE r.id = ?
  `).get(residentId) as any;

  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalCharges,
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalPayments,
      COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalDeposits
    FROM financial_transactions
    WHERE resident_id = ?
  `).get(residentId) as { totalCharges: number; totalPayments: number; totalDeposits: number };

  const transactions = listTransactions(actor, { residentId, limit: 100 });

  const totalRentCharges = totals?.totalCharges || 0;
  const totalRentPaid = totals?.totalPayments || 0;
  const outstandingRentBalance = totalRentCharges - totalRentPaid;
  const totalSecurityDepositHeld = totals?.totalDeposits || 0;

  return {
    residentId: resident.id,
    fullName: resident.fullName,
    phone: resident.phone,
    status: resident.status,
    currentRoomNumber: resident.currentRoomNumber || null,
    totalRentCharges,
    totalRentPaid,
    outstandingRentBalance,
    totalSecurityDepositHeld,
    transactions,
  };
}

/**
 * Calculates persistent Cashbook Summary for a selected date range:
 * - Rent collected in period
 * - Security deposits collected in period
 * - Expenses paid in period
 * - Net cash movement in period = (Rent + Deposits) - Expenses
 * - Current total outstanding rent across all residents in the ERP
 * Requires finance.read permission.
 */
export function getCashbookSummary(
  actor: AuthenticatedUser,
  options?: { startDate?: string; endDate?: string }
): CashbookSummary {
  requirePermission(actor, "finance.read");

  const db = getDb();

  // Default to current calendar month if dates not provided
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const defaultEnd = now.toISOString().slice(0, 10);

  const startDate = options?.startDate && DATE_REGEX.test(options.startDate) ? options.startDate : defaultStart;
  const endDate = options?.endDate && DATE_REGEX.test(options.endDate) ? options.endDate : defaultEnd;

  // 1. Period cash movements
  const periodRows = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as rentCollected,
      COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as depositsCollected,
      COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as expensesPaid,
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as rentBilled,
      COUNT(*) as txCount
    FROM financial_transactions
    WHERE transaction_date >= ? AND transaction_date <= ?
  `).get(startDate, endDate) as {
    rentCollected: number;
    depositsCollected: number;
    expensesPaid: number;
    rentBilled: number;
    txCount: number;
  };

  // 1b. Cross-period reversals: reversals occurring in this period for transactions from a prior period
  const crossPeriodReversals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN orig.transaction_type = 'RENT_PAYMENT' THEN rev.amount ELSE 0 END), 0) as priorRentRefunds,
      COALESCE(SUM(CASE WHEN orig.transaction_type = 'SECURITY_DEPOSIT' THEN rev.amount ELSE 0 END), 0) as priorDepositRefunds,
      COALESCE(SUM(CASE WHEN orig.transaction_type = 'EXPENSE' THEN rev.amount ELSE 0 END), 0) as priorExpenseRefunds
    FROM financial_transactions rev
    JOIN financial_transactions orig ON rev.reversal_of_id = orig.id
    WHERE rev.transaction_type = 'REVERSAL'
      AND rev.status = 'POSTED'
      AND rev.transaction_date >= ? AND rev.transaction_date <= ?
      AND orig.transaction_date < ?
  `).get(startDate, endDate, startDate) as {
    priorRentRefunds: number;
    priorDepositRefunds: number;
    priorExpenseRefunds: number;
  };

  const rawRentCollected = periodRows?.rentCollected || 0;
  const rawDepositsCollected = periodRows?.depositsCollected || 0;
  const rawExpensesPaid = periodRows?.expensesPaid || 0;
  const totalRentBilledInPeriod = periodRows?.rentBilled || 0;
  const transactionCount = periodRows?.txCount || 0;

  const priorRentRefunds = crossPeriodReversals?.priorRentRefunds || 0;
  const priorDepositRefunds = crossPeriodReversals?.priorDepositRefunds || 0;
  const priorExpenseRefunds = crossPeriodReversals?.priorExpenseRefunds || 0;

  const totalRentCollected = rawRentCollected - priorRentRefunds;
  const totalDepositsCollected = rawDepositsCollected - priorDepositRefunds;
  const totalExpensesPaid = Math.max(0, rawExpensesPaid - priorExpenseRefunds);

  // Net Cash Movement = Money In (Rent + Deposits) - Money Out (Expenses)
  const netCashMovement = totalRentCollected + totalDepositsCollected - totalExpensesPaid;

  // 2. Global outstanding rent as of current state across all residents
  const globalOutstandingRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as allCharges,
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as allPayments
    FROM financial_transactions
  `).get() as { allCharges: number; allPayments: number };

  const totalOutstandingRent = Math.max(
    0,
    (globalOutstandingRow?.allCharges || 0) - (globalOutstandingRow?.allPayments || 0)
  );

  return {
    startDate,
    endDate,
    totalRentCollected,
    totalDepositsCollected,
    totalExpensesPaid,
    netCashMovement,
    totalOutstandingRent,
    totalRentBilledInPeriod,
    transactionCount,
  };
}

/**
 * Reverses an existing posted transaction with auditable correction tracking.
 * Requires finance.manage permission.
 */
export function reverseTransaction(
  actor: AuthenticatedUser,
  transactionId: string,
  reason: string,
  clientIp?: string
): FinancialTransaction {
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.transaction_reversed" });

  const cleanReason = reason?.trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw new Error("A clear reason of at least 5 characters is required for financial reversals.");
  }

  const db = getDb();
  const current = getTransactionById(actor, transactionId);
  if (!current) {
    throw new Error(`Transaction '${transactionId}' not found.`);
  }
  if (current.status === "REVERSED") {
    throw new Error(`Transaction '${transactionId}' is already reversed.`);
  }
  if (current.transactionType === "REVERSAL") {
    throw new Error("Reversal records cannot themselves be reversed. Corrections must be made via new posted transactions.");
  }
  if (current.transactionType === "RENT_CHARGE" && current.residentId) {
    const currentBalance = getResidentRentBalance(current.residentId);
    if (current.amount > currentBalance) {
      throw new Error(
        `Cannot reverse rent charge of ₹${current.amount.toLocaleString("en-IN")} because payments have already been applied against it. Remaining unallocated balance is only ₹${Math.max(0, currentBalance).toLocaleString("en-IN")}. Reverse the corresponding payments first.`
      );
    }
  }

  const reversalId = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const tx = db.transaction(() => {
    // 1. Mark original reversed
    db.prepare(`
      UPDATE financial_transactions
      SET status = 'REVERSED', updated_at = ?
      WHERE id = ?
    `).run(now, transactionId);

    // 2. Insert auditable reversal transaction
    db.prepare(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'REVERSAL', ?, ?, ?,
        ?, ?, ?, ?, ?,
        NULL, ?, NULL, 'POSTED',
        ?, ?, ?, ?
      )
    `).run(
      reversalId,
      current.amount,
      today,
      current.paymentMethod,
      current.referenceNumber,
      current.residentId,
      current.stayId,
      current.category,
      `Correction / Reversal of ${current.id}: ${cleanReason}`,
      current.payeeVendor,
      current.id,
      actor.id,
      now,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.transaction_reversed",
      targetType: "transaction",
      targetId: transactionId,
      metadata: {
        reversalId,
        originalType: current.transactionType,
        amount: current.amount,
        reason: cleanReason,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getTransactionById(actor, reversalId)!;
}
