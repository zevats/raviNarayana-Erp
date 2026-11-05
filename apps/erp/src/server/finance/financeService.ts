import crypto from "crypto";
import { businessToday, businessMonthStart } from "@/lib/businessDate";
import { getAsyncDb, AsyncDb } from "../database/db";
import { getOutstandingRent } from "./financialDefinitions";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import {
  AuthenticatedUser,
  TransactionType,
  PaymentMethod,
  CANONICAL_PAYMENT_METHODS,
  normalizePaymentMethod,
  ExpenseCategory,
  TransactionStatus,
  FinancialTransaction,
  ResidentFinancialSummary,
  CashbookSummary,
  ClosingDivision,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = CANONICAL_PAYMENT_METHODS;

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
  paymentMethod: PaymentMethod | string;
  referenceNumber?: string;
  description?: string;
  idempotencyKey?: string;
}

export interface RecordSecurityDepositInput {
  residentId: string;
  stayId?: string;
  amount: number;
  transactionDate: string;
  paymentMethod: PaymentMethod | string;
  referenceNumber?: string;
  description?: string;
  idempotencyKey?: string;
}

export interface RecordExpenseInput {
  category: ExpenseCategory;
  amount: number;
  transactionDate: string;
  paymentMethod: PaymentMethod | string;
  payeeVendor?: string;
  description: string;
  referenceNumber?: string;
  idempotencyKey?: string;
}

export interface ListTransactionsOptions {
  type?: TransactionType;
  category?: string;
  paymentMethod?: PaymentMethod | string;
  residentId?: string;
  customerId?: string;
  stayId?: string;
  startDate?: string;
  endDate?: string;
  division?: ClosingDivision;
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
    customerId: row.customer_id || null,
    customerName: row.customer_name || null,
    stayId: row.stay_id || null,
    roomNumber: row.room_number || null,
    category: row.category,
    description: row.description || null,
    billingPeriod: row.billing_period || null,
    payeeVendor: row.payee_vendor || null,
    idempotencyKey: row.idempotency_key || null,
    status: row.status as TransactionStatus,
    reversalOfId: row.reversal_of_id || null,
    invoiceId: row.invoice_id || null,
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
export async function getResidentRentBalance(
  residentId: string,
  asyncDb?: AsyncDb
): Promise<number> {
  const db = asyncDb ?? getAsyncDb();
  const res = await db.queryOne<{ charges: number | string; payments: number | string }>(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as charges,
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as payments
    FROM financial_transactions
    WHERE resident_id = ?
  `, [residentId]);

  const charges = Number(res?.charges || 0);
  const payments = Number(res?.payments || 0);
  return charges - payments;
}

/**
 * Authoritative Indian Standard Time (Asia/Kolkata) date string formatter (YYYY-MM-DD).
 * Ensures consistency around midnight in India and prevents UTC calendar drift.
 */
export function getBusinessDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

/**
 * Canonical acquisition order for closing advisory locks. Every shared and exclusive
 * acquisition must follow this order, otherwise a division writer (holding PG, wanting
 * COMBINED) and a COMBINED finalizer (holding COMBINED, wanting PG) deadlock (40P01).
 */
const CLOSING_LOCK_ORDER = ["COMBINED", "PG", "TIFFIN"] as const;

function closingLockKeys(date: string, divisions: ReadonlyArray<"PG" | "TIFFIN" | "COMBINED">): string[] {
  return CLOSING_LOCK_ORDER.filter((d) => divisions.includes(d)).map((d) => `closing:${date}:${d}`);
}

/**
 * Acquires a PostgreSQL transactional advisory shared lock on the closing date/division.
 * Ensures concurrent finalizations wait for active ledger writes, and new ledger writes
 * wait for active finalization.
 *
 * Lock failures (including 40P01) propagate: on PostgreSQL a failed statement aborts the
 * transaction, so continuing would only surface a misleading error later.
 */
export async function acquireClosingSharedLock(
  tx: AsyncDb,
  transactionDate: string,
  division: "PG" | "TIFFIN" | "COMBINED"
): Promise<void> {
  if (!tx.isPostgres) return;
  const divisions = division === "COMBINED" ? CLOSING_LOCK_ORDER : [division, "COMBINED" as const];
  for (const key of closingLockKeys(transactionDate, divisions)) {
    await tx.query("SELECT pg_advisory_xact_lock_shared(4201, hashtext($1))", [key]);
  }
}

/**
 * Acquires a PostgreSQL transactional advisory exclusive lock on the closing date/division.
 * Blocks all concurrent ledger writers for this date until the closing snapshot is frozen and committed.
 */
export async function acquireClosingExclusiveLock(
  tx: AsyncDb,
  closingDate: string,
  division: "PG" | "TIFFIN" | "COMBINED"
): Promise<void> {
  if (!tx.isPostgres) return;
  const divisions = division === "COMBINED" ? CLOSING_LOCK_ORDER : [division];
  for (const key of closingLockKeys(closingDate, divisions)) {
    await tx.query("SELECT pg_advisory_xact_lock(4201, hashtext($1))", [key]);
  }
}

/**
 * Transaction-scoped advisory lock on an arbitrary ledger key (resident balance, idempotency key).
 * Always acquired after the closing locks, so the global order stays closing -> ledger key.
 * No-op on SQLite, where write transactions are already serialized.
 */
export async function acquireLedgerKeyLock(tx: AsyncDb, key: string): Promise<void> {
  if (!tx.isPostgres) return;
  await tx.query("SELECT pg_advisory_xact_lock(4202, hashtext($1))", [key]);
}

/**
 * Shared, race-safe closing lock policy.
 * Asserts that the transactionDate is not locked by a FINALIZED daily cashbook closing
 * for the given division (or COMBINED).
 * Uses Postgres 'FOR SHARE' row locks (or serialized transactions on SQLite) to ensure
 * concurrent finalizations cannot interleave.
 */
export async function assertClosingDateNotFinalized(
  tx: AsyncDb,
  transactionDate: string,
  division: "PG" | "TIFFIN" | "COMBINED"
): Promise<void> {
  await acquireClosingSharedLock(tx, transactionDate, division);

  const forShare = tx.isPostgres ? " FOR SHARE" : "";
  let query: string;
  let params: any[];

  if (division === "COMBINED") {
    query = `
      SELECT id, closing_date, division, status
      FROM daily_cashbook_closings
      WHERE closing_date = ? AND status = 'FINALIZED'
      LIMIT 1${forShare}
    `;
    params = [transactionDate];
  } else {
    query = `
      SELECT id, closing_date, division, status
      FROM daily_cashbook_closings
      WHERE closing_date = ? AND division IN (?, 'COMBINED') AND status = 'FINALIZED'
      LIMIT 1${forShare}
    `;
    params = [transactionDate, division];
  }

  const locked = await tx.queryOne<{ id: string; closing_date: string; division: string; status: string }>(
    query,
    params
  );

  if (locked) {
    throw new Error(
      `Cannot record transaction on ${transactionDate}. The daily cashbook closing for this date (${locked.division}) is FINALIZED and locked. An authorized manager must reopen the daily closing first.`
    );
  }
}

/**
 * Records an explicit rent charge for a resident & stay.
 * Requires finance.manage permission.
 */
export async function recordRentCharge(
  actor: AuthenticatedUser,
  input: RecordRentChargeInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.rent_charge_recorded" });

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

  // Idempotency: a replayed key returns the original row; a key reused with a different
  // payload is rejected. Checked before the transaction and again under the key lock inside it.
  const replayIdempotent = (existing: any): FinancialTransaction => {
    if (
      existing.transaction_type !== "RENT_CHARGE" ||
      Number(existing.amount) !== amount ||
      existing.resident_id !== residentId ||
      (billingPeriod && existing.billing_period !== billingPeriod)
    ) {
      throw new Error(
        `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
      );
    }
    return mapRowToTransaction(existing);
  };
  if (idempotencyKey) {
    const existing = await db.queryOne<any>(
      "SELECT * FROM financial_transactions WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) return replayIdempotent(existing);
  }
  let replayed: any = null;

  // Validate resident exists
  const resident = await db.queryOne<{ id: string; fullName: string }>(
    "SELECT id, full_name as fullName FROM residents WHERE id = ?",
    [residentId]
  );
  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  // Resolve stayId
  let stayId = input.stayId?.trim() || null;
  if (!stayId) {
    const activeStay = await db.queryOne<{ id: string }>(
      "SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'",
      [residentId]
    );
    if (activeStay) {
      stayId = activeStay.id;
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await assertClosingDateNotFinalized(tx, transactionDate, "PG");

    if (idempotencyKey) {
      // Concurrent duplicates serialize here; the later one replays the committed row.
      await acquireLedgerKeyLock(tx, `idempotency:${idempotencyKey}`);
      replayed = await tx.queryOne<any>("SELECT * FROM financial_transactions WHERE idempotency_key = ?", [idempotencyKey]);
      if (replayed) return;
    }

    await tx.execute(`
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
    `, [
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
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  if (replayed) return replayIdempotent(replayed);
  return (await getTransactionById(actor, id, db))!;
}

/**
 * Records a rent payment received from a resident.
 * Enforces that payment does not silently exceed outstanding rent balance.
 * Requires finance.manage permission.
 */
export async function recordRentPayment(
  actor: AuthenticatedUser,
  input: RecordRentPaymentInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.rent_payment_recorded" });

  const residentId = input.residentId?.trim();
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
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

  // Idempotency: a replayed key returns the original row; a key reused with a different
  // payload is rejected. Checked before the transaction and again under the key lock inside it.
  const replayIdempotent = (existing: any): FinancialTransaction => {
    if (
      existing.transaction_type !== "RENT_PAYMENT" ||
      Number(existing.amount) !== amount ||
      existing.resident_id !== residentId ||
      existing.payment_method !== paymentMethod
    ) {
      throw new Error(
        `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
      );
    }
    return mapRowToTransaction(existing);
  };
  if (idempotencyKey) {
    const existing = await db.queryOne<any>(
      "SELECT * FROM financial_transactions WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) return replayIdempotent(existing);
  }
  let replayed: any = null;

  // Validate resident exists
  const resident = await db.queryOne<{ id: string; fullName: string }>(
    "SELECT id, full_name as fullName FROM residents WHERE id = ?",
    [residentId]
  );
  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  // Check outstanding rent balance
  const currentBalance = await getResidentRentBalance(residentId, db);
  if (amount > currentBalance) {
    throw new Error(
      `Payment amount (₹${amount.toLocaleString("en-IN")}) exceeds current outstanding rent balance (₹${Math.max(0, currentBalance).toLocaleString("en-IN")}). Payments cannot exceed outstanding billed charges.`
    );
  }

  // Resolve stayId
  let stayId = input.stayId?.trim() || null;
  if (!stayId) {
    const activeStay = await db.queryOne<{ id: string }>(
      "SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'",
      [residentId]
    );
    if (activeStay) {
      stayId = activeStay.id;
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await assertClosingDateNotFinalized(tx, transactionDate, "PG");

    if (idempotencyKey) {
      // Concurrent duplicates serialize here; the later one replays the committed row.
      await acquireLedgerKeyLock(tx, `idempotency:${idempotencyKey}`);
      replayed = await tx.queryOne<any>("SELECT * FROM financial_transactions WHERE idempotency_key = ?", [idempotencyKey]);
      if (replayed) return;
    }

    // Overpayment guard under a per-resident lock: concurrent payments for the same resident
    // serialize here, so the balance read below includes every committed payment.
    await acquireLedgerKeyLock(tx, `resident:${residentId}`);
    const lockedBalance = await getResidentRentBalance(residentId, tx);
    if (amount > lockedBalance) {
      throw new Error(
        `Payment amount (₹${amount.toLocaleString("en-IN")}) exceeds current outstanding rent balance (₹${Math.max(0, lockedBalance).toLocaleString("en-IN")}). Payments cannot exceed outstanding billed charges.`
      );
    }

    await tx.execute(`
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
    `, [
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
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  if (replayed) return replayIdempotent(replayed);
  return (await getTransactionById(actor, id, db))!;
}

/**
 * Records a security deposit received.
 * Strictly classified as a held deposit liability, separate from rent revenue.
 * Requires finance.manage permission.
 */
export async function recordSecurityDeposit(
  actor: AuthenticatedUser,
  input: RecordSecurityDepositInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.security_deposit_recorded" });

  const residentId = input.residentId?.trim();
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
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

  // Idempotency: a replayed key returns the original row; a key reused with a different
  // payload is rejected. Checked before the transaction and again under the key lock inside it.
  const replayIdempotent = (existing: any): FinancialTransaction => {
    if (
      existing.transaction_type !== "SECURITY_DEPOSIT" ||
      Number(existing.amount) !== amount ||
      existing.resident_id !== residentId ||
      existing.payment_method !== paymentMethod
    ) {
      throw new Error(
        `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
      );
    }
    return mapRowToTransaction(existing);
  };
  if (idempotencyKey) {
    const existing = await db.queryOne<any>(
      "SELECT * FROM financial_transactions WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) return replayIdempotent(existing);
  }
  let replayed: any = null;

  const resident = await db.queryOne<{ id: string; fullName: string }>(
    "SELECT id, full_name as fullName FROM residents WHERE id = ?",
    [residentId]
  );
  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  let stayId = input.stayId?.trim() || null;
  if (!stayId) {
    const activeStay = await db.queryOne<{ id: string }>(
      "SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'",
      [residentId]
    );
    if (activeStay) {
      stayId = activeStay.id;
    }
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await assertClosingDateNotFinalized(tx, transactionDate, "PG");

    if (idempotencyKey) {
      // Concurrent duplicates serialize here; the later one replays the committed row.
      await acquireLedgerKeyLock(tx, `idempotency:${idempotencyKey}`);
      replayed = await tx.queryOne<any>("SELECT * FROM financial_transactions WHERE idempotency_key = ?", [idempotencyKey]);
      if (replayed) return;
    }

    await tx.execute(`
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
    `, [
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
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  if (replayed) return replayIdempotent(replayed);
  return (await getTransactionById(actor, id, db))!;
}

/**
 * Records an operational business expense.
 * Reduces cashbook net movement; does NOT affect resident rent balances.
 * Requires finance.manage permission.
 */
export async function recordExpense(
  actor: AuthenticatedUser,
  input: RecordExpenseInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.expense_recorded" });

  const category = input.category;
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
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
  if (!description || description.length < 3) {
    throw new Error("Expense description of at least 3 characters is required.");
  }

  // Idempotency: a replayed key returns the original row; a key reused with a different
  // payload is rejected. Checked before the transaction and again under the key lock inside it.
  const replayIdempotent = (existing: any): FinancialTransaction => {
    if (
      existing.transaction_type !== "EXPENSE" ||
      Number(existing.amount) !== amount ||
      existing.category !== category ||
      existing.payment_method !== paymentMethod
    ) {
      throw new Error(
        `Idempotency key '${idempotencyKey}' was already used with a different transaction payload. Mismatched payload reuse is strictly rejected.`
      );
    }
    return mapRowToTransaction(existing);
  };
  if (idempotencyKey) {
    const existing = await db.queryOne<any>(
      "SELECT * FROM financial_transactions WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) return replayIdempotent(existing);
  }
  let replayed: any = null;

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    const expenseDivision = category === "GROCERY" || category === "KITCHEN_SUPPLIES" ? "TIFFIN" : "PG";
    await assertClosingDateNotFinalized(tx, transactionDate, expenseDivision);

    if (idempotencyKey) {
      // Concurrent duplicates serialize here; the later one replays the committed row.
      await acquireLedgerKeyLock(tx, `idempotency:${idempotencyKey}`);
      replayed = await tx.queryOne<any>("SELECT * FROM financial_transactions WHERE idempotency_key = ?", [idempotencyKey]);
      if (replayed) return;
    }

    await tx.execute(`
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
    `, [
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
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  if (replayed) return replayIdempotent(replayed);
  return (await getTransactionById(actor, id, db))!;
}

/**
 * Retrieves a single transaction by ID.
 * Requires finance.read permission.
 */
export async function getTransactionById(
  actor: AuthenticatedUser,
  transactionId: string,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction | null> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
  const row = await db.queryOne<any>(`
    SELECT
      t.*,
      r.full_name as resident_name,
      tc.full_name as customer_name,
      rm.room_number,
      u.full_name as created_by_name
    FROM financial_transactions t
    LEFT JOIN residents r ON r.id = t.resident_id
    LEFT JOIN tiffin_customers tc ON tc.id = t.customer_id
    LEFT JOIN resident_stays s ON s.id = t.stay_id
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN staff_users u ON u.id = t.created_by
    WHERE t.id = ?
  `, [transactionId]);

  if (!row) return null;
  return mapRowToTransaction(row);
}

/**
 * Lists financial transactions with flexible date, category, and type filters.
 * Requires finance.read permission.
 */
export async function listTransactions(
  actor: AuthenticatedUser,
  options?: ListTransactionsOptions,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction[]> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
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
  if (options?.paymentMethod) {
    const normalizedMethod = normalizePaymentMethod(options.paymentMethod);
    conditions.push("t.payment_method = ?");
    params.push(normalizedMethod);
  }
  if (options?.residentId) {
    conditions.push("t.resident_id = ?");
    params.push(options.residentId);
  }
  if (options?.customerId) {
    conditions.push("t.customer_id = ?");
    params.push(options.customerId);
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
  if (options?.division === "PG") {
    conditions.push("(t.resident_id IS NOT NULL OR t.transaction_type IN ('RENT_PAYMENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND', 'RENT_CHARGE') OR (t.transaction_type = 'EXPENSE' AND t.category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES')))");
  } else if (options?.division === "TIFFIN") {
    conditions.push("(t.customer_id IS NOT NULL OR t.transaction_type IN ('TIFFIN_PAYMENT', 'TIFFIN_CHARGE') OR (t.transaction_type = 'EXPENSE' AND t.category IN ('GROCERY', 'KITCHEN_SUPPLIES')))");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 100));
  const offset = Math.max(0, Number(options?.offset) || 0);

  const rows = await db.query<any>(`
    SELECT
      t.*,
      r.full_name as resident_name,
      tc.full_name as customer_name,
      rm.room_number,
      u.full_name as created_by_name
    FROM financial_transactions t
    LEFT JOIN residents r ON r.id = t.resident_id
    LEFT JOIN tiffin_customers tc ON tc.id = t.customer_id
    LEFT JOIN resident_stays s ON s.id = t.stay_id
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN staff_users u ON u.id = t.created_by
    ${whereClause}
    ORDER BY t.transaction_date DESC, t.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return rows.map(mapRowToTransaction);
}

/**
 * Calculates resident financial dossier:
 * rent charges, payments, outstanding balance, deposits held, and ledger entries.
 * Requires finance.read permission.
 */
export async function getResidentFinancialSummary(
  actor: AuthenticatedUser,
  residentId: string,
  asyncDb?: AsyncDb
): Promise<ResidentFinancialSummary> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();

  const resident = await db.queryOne<any>(`
    SELECT r.id, r.full_name as fullName, r.phone, r.status, rm.room_number as currentRoomNumber
    FROM residents r
    LEFT JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
    LEFT JOIN rooms rm ON rm.id = s.room_id
    WHERE r.id = ?
  `, [residentId]);

  if (!resident) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  const totals = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalCharges,
      COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalPayments,
      COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN (transaction_type = 'DEPOSIT_REFUND' OR (transaction_type = 'RENT_PAYMENT' AND COALESCE(category, '') = 'DEPOSIT_APPLICATION')) AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalDeposits
    FROM financial_transactions
    WHERE resident_id = ?
  `, [residentId]);

  const transactions = await listTransactions(actor, { residentId, limit: 100 }, db);

  const totalRentCharges = Number(totals?.totalCharges || 0);
  const totalRentPaid = Number(totals?.totalPayments || 0);
  const outstandingRentBalance = totalRentCharges - totalRentPaid;
  const totalSecurityDepositHeld = Number(totals?.totalDeposits || 0);

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
export async function getCashbookSummary(
  actor: AuthenticatedUser,
  options?: { startDate?: string; endDate?: string; division?: ClosingDivision },
  asyncDb?: AsyncDb
): Promise<CashbookSummary> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
  const division = options?.division || "COMBINED";

  // Default to current calendar month if dates not provided
  const defaultStart = businessMonthStart();
  const defaultEnd = businessToday();

  const startDate = options?.startDate && DATE_REGEX.test(options.startDate) ? options.startDate : defaultStart;
  const endDate = options?.endDate && DATE_REGEX.test(options.endDate) ? options.endDate : defaultEnd;

  // 1. Concurrently fetch period cash movements, cross-period reversals, and global outstanding rent
  const [periodRows, crossPeriodReversals, globalOutstandingRow] = await Promise.all([
    db.queryOne<any>(`
      SELECT
        COALESCE(SUM(CASE WHEN t.transaction_type = 'RENT_PAYMENT' AND COALESCE(t.category, '') NOT IN ('DEPOSIT_APPLICATION', 'TIFFIN') AND t.customer_id IS NULL AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as rentCollected,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'SECURITY_DEPOSIT' AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as depositsCollected,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'DEPOSIT_REFUND' AND t.status = 'POSTED' THEN t.amount ELSE 0 END), 0) as depositRefunds,
        COALESCE(SUM(CASE WHEN (t.transaction_type = 'TIFFIN_PAYMENT' OR (t.transaction_type = 'RENT_PAYMENT' AND (t.customer_id IS NOT NULL OR t.category = 'TIFFIN'))) AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as tiffinCollected,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as expensesPaid,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as allExpensesPaid,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND t.category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES') AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as pgExpensesPaid,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'EXPENSE' AND t.category IN ('GROCERY', 'KITCHEN_SUPPLIES') AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as tiffinExpensesPaid,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'RENT_CHARGE' AND (t.status = 'POSTED' OR (t.status = 'REVERSED' AND rev.transaction_date > ?)) THEN t.amount ELSE 0 END), 0) as rentBilled,
        COUNT(*) as txCount
      FROM financial_transactions t
      LEFT JOIN financial_transactions rev ON rev.reversal_of_id = t.id AND rev.transaction_type = 'REVERSAL'
      WHERE t.transaction_date >= ? AND t.transaction_date <= ?
    `, [endDate, endDate, endDate, endDate, endDate, endDate, endDate, endDate, startDate, endDate]),
    db.queryOne<any>(`
      SELECT
        COALESCE(SUM(CASE WHEN orig.transaction_type = 'RENT_PAYMENT' AND COALESCE(orig.category, '') NOT IN ('DEPOSIT_APPLICATION', 'TIFFIN') AND orig.customer_id IS NULL THEN rev.amount ELSE 0 END), 0) as priorRentRefunds,
        COALESCE(SUM(CASE WHEN orig.transaction_type = 'SECURITY_DEPOSIT' THEN rev.amount ELSE 0 END), 0) as priorDepositRefunds,
        COALESCE(SUM(CASE WHEN orig.transaction_type = 'TIFFIN_PAYMENT' OR (orig.transaction_type = 'RENT_PAYMENT' AND (orig.customer_id IS NOT NULL OR orig.category = 'TIFFIN')) THEN rev.amount ELSE 0 END), 0) as priorTiffinRefunds,
        COALESCE(SUM(CASE WHEN orig.transaction_type = 'EXPENSE' THEN rev.amount ELSE 0 END), 0) as priorExpenseRefunds,
        COALESCE(SUM(CASE WHEN orig.transaction_type = 'EXPENSE' AND orig.category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES') THEN rev.amount ELSE 0 END), 0) as priorPgExpenseRefunds,
        COALESCE(SUM(CASE WHEN orig.transaction_type = 'EXPENSE' AND orig.category IN ('GROCERY', 'KITCHEN_SUPPLIES') THEN rev.amount ELSE 0 END), 0) as priorTiffinExpenseRefunds
      FROM financial_transactions rev
      JOIN financial_transactions orig ON rev.reversal_of_id = orig.id
      WHERE rev.transaction_type = 'REVERSAL'
        AND rev.status = 'POSTED'
        AND rev.transaction_date >= ? AND rev.transaction_date <= ?
        AND orig.transaction_date < ?
    `, [startDate, endDate, startDate]),
    getOutstandingRent(db),
  ]);

  const rawRentCollected = Number(periodRows?.rentCollected || 0);
  const rawDepositsCollected = Number(periodRows?.depositsCollected || 0);
  const rawTiffinCollected = Number(periodRows?.tiffinCollected || 0);
  const rawAllExpensesPaid = Number(periodRows?.allExpensesPaid ?? periodRows?.expensesPaid ?? 0);
  const rawPgExpensesPaid = Number(periodRows?.pgExpensesPaid ?? (division === "TIFFIN" ? 0 : (periodRows?.expensesPaid ?? 0)));
  const rawTiffinExpensesPaid = Number(periodRows?.tiffinExpensesPaid ?? (division === "PG" ? 0 : (periodRows?.expensesPaid ?? 0)));
  const rawDepositRefunds = Number(periodRows?.depositRefunds || 0);
  const rawRentBilledInPeriod = Number(periodRows?.rentBilled || 0);
  const transactionCount = Number(periodRows?.txCount || 0);

  const priorRentRefunds = Number(crossPeriodReversals?.priorRentRefunds || 0);
  const priorDepositRefunds = Number(crossPeriodReversals?.priorDepositRefunds || 0);
  const priorTiffinRefunds = Number(crossPeriodReversals?.priorTiffinRefunds || 0);
  const priorAllExpenseRefunds = Number(crossPeriodReversals?.priorExpenseRefunds || 0);
  const priorPgExpenseRefunds = Number(crossPeriodReversals?.priorPgExpenseRefunds || 0);
  const priorTiffinExpenseRefunds = Number(crossPeriodReversals?.priorTiffinExpenseRefunds || 0);

  let totalRentCollected = 0;
  let totalDepositsCollected = 0;
  let totalTiffinCollected = 0;
  let totalExpensesPaid = 0;
  let totalRentBilledInPeriod = 0;
  let totalOutstandingRent = 0;

  if (division === "PG") {
    totalRentCollected = Math.max(0, rawRentCollected - priorRentRefunds);
    totalDepositsCollected = rawDepositsCollected - priorDepositRefunds - rawDepositRefunds;
    totalTiffinCollected = 0;
    totalExpensesPaid = Math.max(0, rawPgExpensesPaid - priorPgExpenseRefunds);
    totalRentBilledInPeriod = rawRentBilledInPeriod;
    totalOutstandingRent = globalOutstandingRow.total;
  } else if (division === "TIFFIN") {
    totalRentCollected = 0;
    totalDepositsCollected = 0;
    totalTiffinCollected = Math.max(0, rawTiffinCollected - priorTiffinRefunds);
    totalExpensesPaid = Math.max(0, rawTiffinExpensesPaid - priorTiffinExpenseRefunds);
    totalRentBilledInPeriod = 0;
    totalOutstandingRent = 0;
  } else {
    // COMBINED
    totalRentCollected = Math.max(0, rawRentCollected - priorRentRefunds);
    totalDepositsCollected = rawDepositsCollected - priorDepositRefunds - rawDepositRefunds;
    totalTiffinCollected = Math.max(0, rawTiffinCollected - priorTiffinRefunds);
    totalExpensesPaid = Math.max(0, rawAllExpensesPaid - priorAllExpenseRefunds);
    totalRentBilledInPeriod = rawRentBilledInPeriod;
    totalOutstandingRent = globalOutstandingRow.total;
  }

  // Net Cash Movement = Money In (Rent + Deposits + Tiffin) - Money Out (Expenses)
  const netCashMovement = totalRentCollected + totalDepositsCollected + totalTiffinCollected - totalExpensesPaid;

  // Owner decision D9 (option C): receipts and refunds of earlier receipts are shown separately and
  // the net may be negative, so months add up to longer ranges and match the daily closings. The
  // floored figures above stay as they were for existing callers; the Cashbook shows these.
  const pgSide = division !== "TIFFIN";
  const tiffinSide = division !== "PG";
  const breakdown = {
    rentReceipts: pgSide ? rawRentCollected : 0,
    rentRefunds: pgSide ? priorRentRefunds : 0,
    tiffinReceipts: tiffinSide ? rawTiffinCollected : 0,
    tiffinRefunds: tiffinSide ? priorTiffinRefunds : 0,
    expensesPaid: division === "PG" ? rawPgExpensesPaid : division === "TIFFIN" ? rawTiffinExpensesPaid : rawAllExpensesPaid,
    expenseRefunds: division === "PG" ? priorPgExpenseRefunds : division === "TIFFIN" ? priorTiffinExpenseRefunds : priorAllExpenseRefunds,
  };
  const netCashMovementExact =
    breakdown.rentReceipts - breakdown.rentRefunds +
    totalDepositsCollected +
    breakdown.tiffinReceipts - breakdown.tiffinRefunds -
    (breakdown.expensesPaid - breakdown.expenseRefunds);

  return {
    startDate,
    endDate,
    division,
    totalRentCollected,
    totalDepositsCollected,
    totalTiffinCollected,
    totalExpensesPaid,
    netCashMovement,
    totalOutstandingRent,
    totalRentBilledInPeriod,
    transactionCount,
    breakdown,
    netCashMovementExact,
  };
}

/**
 * Reverses an existing posted transaction with auditable correction tracking.
 * Requires finance.manage permission.
 */
export async function reverseTransaction(
  actor: AuthenticatedUser,
  transactionId: string,
  reason: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<FinancialTransaction> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.transaction_reversed" });

  const cleanReason = reason?.trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw new Error("A clear reason of at least 5 characters is required for financial reversals.");
  }

  const current = await getTransactionById(actor, transactionId, db);
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
    const currentBalance = await getResidentRentBalance(current.residentId, db);
    if (current.amount > currentBalance) {
      throw new Error(
        `Cannot reverse rent charge of ₹${current.amount.toLocaleString("en-IN")} because payments have already been applied against it. Remaining unallocated balance is only ₹${Math.max(0, currentBalance).toLocaleString("en-IN")}. Reverse the corresponding payments first.`
      );
    }
  }
  if (current.transactionType === "TIFFIN_CHARGE" && current.customerId) {
    const { getTiffinCustomerBalance } = await import("../tiffin/tiffinBillingService");
    const balance = await getTiffinCustomerBalance(actor, current.customerId, db);
    if (current.amount > balance.outstandingBalance) {
      throw new Error(
        `Cannot reverse tiffin charge of ₹${current.amount.toLocaleString("en-IN")} because payments have already been applied against it. Remaining balance is only ₹${Math.max(0, balance.outstandingBalance).toLocaleString("en-IN")}. Reverse the corresponding payments first.`
      );
    }
  }

  // A delivery staff handover is booked as one entry for several collections (cash, or UPI before
  // migration 0014). Reversing it here would take the money out of the cashbook while staff custody
  // and every order in it still say it was received, so it is refused; the handover is corrected
  // where it was accepted. A single UPI collection's own entry is reversed below together with
  // its delivery.
  if (current.transactionType === "TIFFIN_PAYMENT" && current.category === "TIFFIN_DELIVERY_COLLECTION") {
    const handover = await db.queryOne<{ id: string }>(
      "SELECT id FROM driver_cash_handovers WHERE transaction_id = ? OR upi_transaction_id = ? LIMIT 1",
      [transactionId, transactionId]
    );
    if (handover) {
      throw new Error(
        "This entry is a delivery staff handover covering several collections. It cannot be reversed from the cashbook, because staff custody and the orders it covers would still show the money as received."
      );
    }
  }

  const reversalId = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const today = getBusinessDateString(new Date());
  let allocationsKept = 0;
  let deliveryCollection: { deliveryTaskId: string; orderId: string | null; amount: number; collectedNow: number } | null = null;
  const reversalDivision =
    current.transactionType === "TIFFIN_PAYMENT" ||
    current.transactionType === "TIFFIN_CHARGE" ||
    (current.transactionType === "EXPENSE" && (current.category === "GROCERY" || current.category === "KITCHEN_SUPPLIES"))
      ? "TIFFIN"
      : "PG";

  await db.transaction(async (tx) => {
    await assertClosingDateNotFinalized(tx, today, reversalDivision);

    if (current.residentId) {
      // Same lock as rent payments: a charge cannot be reversed while a payment against it commits.
      await acquireLedgerKeyLock(tx, `resident:${current.residentId}`);
      if (current.transactionType === "RENT_CHARGE") {
        const lockedBalance = await getResidentRentBalance(current.residentId, tx);
        if (current.amount > lockedBalance) {
          throw new Error(
            `Cannot reverse rent charge of ₹${current.amount.toLocaleString("en-IN")} because payments have already been applied against it. Reverse the corresponding payments first.`
          );
        }
      }
    }

    // 1. Mark original reversed. The status guard makes concurrent reversals of the same
    //    transaction mutually exclusive: only one request flips POSTED -> REVERSED.
    const flipped = await tx.execute(`
      UPDATE financial_transactions
      SET status = 'REVERSED', updated_at = ?
      WHERE id = ? AND status = 'POSTED'
    `, [now, transactionId]);
    if (flipped.changes === 0) {
      throw new Error(`Transaction '${transactionId}' is already reversed.`);
    }

    // Reversing a RENT_PAYMENT or TIFFIN_PAYMENT gives its allocated amounts back to the invoices.
    // The allocation rows are kept as history: an allocation counts only while its payment is
    // POSTED, so they stop counting the moment the status flip above commits. Each invoice row is
    // locked before it is read (payment first, then invoice: the order allocations use).
    if (current.transactionType === "RENT_PAYMENT" || current.transactionType === "TIFFIN_PAYMENT") {
      const allocations = await tx.query<{ id: string; invoiceId: string; amount: number }>(`
        SELECT id, invoice_id as "invoiceId", amount
        FROM invoice_payment_allocations
        WHERE payment_transaction_id = ?
        ORDER BY invoice_id
      `, [transactionId]);

      for (const alloc of allocations) {
        const inv = await tx.queryOne<{ id: string; amountPaid: number; balanceDue: number }>(`
          SELECT id, amount_paid as "amountPaid", balance_due as "balanceDue"
          FROM invoices
          WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}
        `, [alloc.invoiceId]);

        if (inv) {
          const newPaid = Math.max(0, Number(inv.amountPaid) - Number(alloc.amount));
          const newDue = Number(inv.balanceDue) + Number(alloc.amount);
          const newStatus = newPaid === 0 ? "ISSUED" : "PARTIALLY_PAID";
          await tx.execute(`
            UPDATE invoices
            SET amount_paid = ?, balance_due = ?, status = ?, updated_at = ?
            WHERE id = ?
          `, [newPaid, newDue, newStatus, now, inv.id]);
        }
        allocationsKept++;
      }
    }

    // A delivery collection's own entry (UPI paid to the PG account): the order's balance comes back.
    if (current.transactionType === "TIFFIN_PAYMENT" && current.category === "TIFFIN_DELIVERY_COLLECTION") {
      const { applyCollectionEntryReversal } = await import("../delivery/deliveryService");
      deliveryCollection = await applyCollectionEntryReversal(tx, transactionId, actor, cleanReason, now);
    }


    // 2. Insert auditable reversal transaction
    await tx.execute(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, customer_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'REVERSAL', ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        NULL, ?, NULL, 'POSTED',
        ?, ?, ?, ?
      )
    `, [
      reversalId,
      current.amount,
      today,
      current.paymentMethod,
      current.referenceNumber,
      current.residentId,
      current.customerId,
      current.stayId,
      current.category,
      `Correction / Reversal of ${current.id}: ${cleanReason}`,
      current.payeeVendor,
      current.id,
      actor.id,
      now,
      now
    ]);

    await recordAuditEventAsync({
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
        allocationsKept,
        deliveryCollection,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getTransactionById(actor, reversalId, db))!;
}
