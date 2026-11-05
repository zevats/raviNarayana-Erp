import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { CompanyBillingConfig } from "../database/env";
import { getInvoiceCompanyConfig } from "../settings/settingsService";
import { assertClosingDateNotFinalized, acquireLedgerKeyLock } from "./financeService";
import { assertValidGstin } from "./gstinValidator";
import { canonicalBillingMonth, chargeIsForMonth } from "./billingPeriod";
import { hasInvoiceIdempotencySchema } from "../database/schemaFeatures";
import {
  AuthenticatedUser,
  Invoice,
  InvoiceItem,
  InvoicePaymentAllocation,
  InvoiceType,
  InvoiceStatus,
  InvoiceCategory,
  ClosingDivision,
  CreateInvoiceInput,
  CreateInvoiceItemInput,
  AllocatePaymentInput,
  FinancialTransaction,
  PaymentMethod,
  TransactionStatus,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface CalculatedItem {
  description: string;
  sacHsnCode: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalItemAmount: number;
}

export interface CalculatedTotals {
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  totalAmount: number;
  items: CalculatedItem[];
}

/**
 * Calculates line-item and aggregate invoice totals.
 * For REGULAR_BILL, tax rates are strictly 0%.
 * For GST_TAX_INVOICE, calculates CGST/SGST (intrastate) or IGST (interstate) at 0, 5, 12, or 18%.
 */
export function calculateInvoiceTotals(
  items: CreateInvoiceItemInput[],
  invoiceType: InvoiceType,
  companyStateCode: string,
  recipientStateCode: string
): CalculatedTotals {
  if (!items || items.length === 0) {
    throw new Error("Invoice must contain at least one line item.");
  }

  const isGst = invoiceType === "GST_TAX_INVOICE";
  const isIntrastate = isGst && companyStateCode.trim() === recipientStateCode.trim();

  let subtotal = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  const calculatedItems: CalculatedItem[] = [];

  for (const item of items) {
    const desc = item.description?.trim();
    if (!desc) {
      throw new Error("Line item description is required.");
    }
    const qty = Number(item.quantity ?? 1);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`Invalid quantity '${item.quantity}'. Must be a positive integer.`);
    }
    const unitPrice = Number(item.unitPrice);
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      throw new Error(`Invalid unit price '${item.unitPrice}'. Must be a non-negative integer in INR.`);
    }

    const amount = qty * unitPrice;
    subtotal += amount;

    let taxRate = 0;
    let cgstRate = 0;
    let sgstRate = 0;
    let igstRate = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (isGst) {
      taxRate = Number(item.taxRate ?? 0);
      if (![0, 5, 12, 18].includes(taxRate)) {
        throw new Error(`Unsupported GST tax rate '${taxRate}%'. Supported rates are 0%, 5%, 12%, 18%.`);
      }

      if (taxRate > 0) {
        if (isIntrastate) {
          cgstRate = taxRate / 2;
          sgstRate = taxRate / 2;
          igstRate = 0;
          cgstAmount = Math.round((amount * cgstRate) / 100);
          sgstAmount = Math.round((amount * sgstRate) / 100);
          igstAmount = 0;
        } else {
          cgstRate = 0;
          sgstRate = 0;
          igstRate = taxRate;
          cgstAmount = 0;
          sgstAmount = 0;
          igstAmount = Math.round((amount * igstRate) / 100);
        }
      }
    }

    totalCgst += cgstAmount;
    totalSgst += sgstAmount;
    totalIgst += igstAmount;

    const totalItemAmount = amount + cgstAmount + sgstAmount + igstAmount;

    calculatedItems.push({
      description: desc,
      sacHsnCode: item.sacHsnCode?.trim() || null,
      quantity: qty,
      unitPrice,
      amount,
      taxRate,
      cgstRate,
      sgstRate,
      igstRate,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalItemAmount,
    });
  }

  const totalTax = totalCgst + totalSgst + totalIgst;
  const totalAmount = subtotal + totalTax;

  return {
    subtotal,
    cgstAmount: totalCgst,
    sgstAmount: totalSgst,
    igstAmount: totalIgst,
    totalTax,
    totalAmount,
    items: calculatedItems,
  };
}

/**
 * Concurrency-safe sequential invoice number generator.
 * Formats numbers as INV-YYYY-NNNN (e.g. INV-2026-0001).
 */
export async function generateNextInvoiceNumber(year: number, tx: AsyncDb): Promise<string> {
  const now = new Date().toISOString();

  await tx.execute(`
    INSERT INTO invoice_counters (year, last_number, updated_at)
    VALUES (?, 0, ?)
    ON CONFLICT (year) DO NOTHING
  `, [year, now]);

  const row = await tx.queryOne<{ lastNumber: number | string }>(
    tx.isPostgres
      ? 'SELECT last_number as "lastNumber" FROM invoice_counters WHERE year = ? FOR UPDATE'
      : 'SELECT last_number as "lastNumber" FROM invoice_counters WHERE year = ?',
    [year]
  );

  const nextNumber = Number(row?.lastNumber ?? 0) + 1;

  await tx.execute(
    "UPDATE invoice_counters SET last_number = ?, updated_at = ? WHERE year = ?",
    [nextNumber, now, year]
  );

  return `INV-${year}-${String(nextNumber).padStart(4, "0")}`;
}

function mapRowToInvoice(row: any, items: InvoiceItem[] = [], allocations: InvoicePaymentAllocation[] = []): Invoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number || null,
    invoiceType: row.invoice_type as InvoiceType,
    invoiceCategory: (row.invoice_category as InvoiceCategory) || "RESIDENT",
    status: row.status as InvoiceStatus,
    residentId: row.resident_id || null,
    residentName: row.resident_name || null,
    customerId: row.customer_id || null,
    customerName: row.customer_name || null,
    subscriptionId: row.subscription_id || null,
    stayId: row.stay_id || null,
    roomNumber: row.room_number || null,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    billingPeriod: row.billing_period,
    subtotal: Number(row.subtotal),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    totalTax: Number(row.total_tax),
    totalAmount: Number(row.total_amount),
    amountPaid: Number(row.amount_paid),
    balanceDue: Number(row.balance_due),
    companyName: row.company_name,
    companyAddress: row.company_address,
    companyGstin: row.company_gstin || null,
    companyStateCode: row.company_state_code,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    recipientEmail: row.recipient_email || null,
    recipientAddress: row.recipient_address || null,
    recipientGstin: row.recipient_gstin || null,
    recipientStateCode: row.recipient_state_code,
    rentChargeId: row.rent_charge_id || null,
    notes: row.notes || null,
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    allocations,
  };
}

function mapRowToItem(row: any): InvoiceItem {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    subscriptionId: row.subscription_id || null,
    serviceStartDate: row.service_start_date || null,
    serviceEndDate: row.service_end_date || null,
    description: row.description,
    sacHsnCode: row.sac_hsn_code || null,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    amount: Number(row.amount),
    taxRate: Number(row.tax_rate),
    cgstRate: Number(row.cgst_rate),
    sgstRate: Number(row.sgst_rate),
    igstRate: Number(row.igst_rate),
    cgstAmount: Number(row.cgst_amount),
    sgstAmount: Number(row.sgst_amount),
    igstAmount: Number(row.igst_amount),
    totalItemAmount: Number(row.total_item_amount),
    createdAt: row.created_at,
  };
}

function mapRowToAllocation(row: any): InvoicePaymentAllocation {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    paymentTransactionId: row.payment_transaction_id,
    paymentDate: row.payment_date || null,
    paymentMethod: row.payment_method ? (row.payment_method as PaymentMethod) : null,
    referenceNumber: row.reference_number || null,
    amount: Number(row.amount),
    allocatedAt: row.allocated_at,
    allocatedBy: row.allocated_by,
    allocatedByName: row.allocated_by_name || null,
    notes: row.notes || null,
    createdAt: row.created_at,
    paymentReversed: row.payment_status === "REVERSED",
  };
}

/**
 * The rent charge a resident invoice stands for, inside the issuing transaction: links the
 * resident's unbilled rent charge for the invoice's period, or posts a new charge.
 *
 * As before, an unbilled charge whose period text is exactly the invoice's is linked. In addition,
 * when the invoice's period is a recognisable month ("Nov 2026", "November 2026", "2026-11"…), an
 * unbilled charge of the same month and the same amount is linked even when the month is written
 * differently, so the month the rent run (or a manual entry) already charged is not charged again.
 * A charge is linked to at most one invoice (guarded update), and issues for a recognisable month
 * take the monthly rent run's lock for that month, so an issue and a rent run cannot both post it.
 * An invoice that matches no unbilled charge posts its own charge, as before: a resident can be
 * invoiced more than once in a month (utilities, maintenance, a GST invoice), which is unchanged.
 */
async function resolveResidentRentCharge(
  tx: AsyncDb,
  p: {
    invoiceId: string;
    residentId: string;
    stayId: string | null;
    billingPeriod: string;
    amount: number;
    issueDate: string;
    invoiceNumber: string;
    linkExisting: boolean;
    actorId: string;
    now: string;
  }
): Promise<string> {
  const month = canonicalBillingMonth(p.billingPeriod);
  if (month) await acquireLedgerKeyLock(tx, `rent-run:${month}`);

  const link = async (chargeId: string) =>
    (await tx.execute(
      "UPDATE financial_transactions SET invoice_id = ?, updated_at = ? WHERE id = ? AND invoice_id IS NULL AND status = 'POSTED'",
      [p.invoiceId, p.now, chargeId]
    )).changes === 1;

  if (p.linkExisting) {
    const exact = await tx.query<{ id: string }>(`
      SELECT id FROM financial_transactions
      WHERE resident_id = ? AND billing_period = ? AND transaction_type = 'RENT_CHARGE' AND status = 'POSTED' AND invoice_id IS NULL
      ORDER BY transaction_date ASC, created_at ASC
    `, [p.residentId, p.billingPeriod]);
    for (const c of exact) if (await link(c.id)) return c.id;

    if (month) {
      const charges = await tx.query<{ id: string; stay_id: string | null; amount: number | string; billing_period: string | null; transaction_date: string }>(
        `SELECT id, stay_id, amount, billing_period, transaction_date
         FROM financial_transactions
         WHERE resident_id = ? AND transaction_type = 'RENT_CHARGE' AND status = 'POSTED' AND invoice_id IS NULL
         ORDER BY transaction_date ASC, created_at ASC`,
        [p.residentId]
      );
      const sameMonth = charges.filter((c) => Number(c.amount) === p.amount && chargeIsForMonth(c, month));
      sameMonth.sort((a, b) => Number(b.stay_id === p.stayId) - Number(a.stay_id === p.stayId));
      for (const c of sameMonth) if (await link(c.id)) return c.id;
    }
  }

  await assertClosingDateNotFinalized(tx, p.issueDate, "PG");
  const chargeId = `txn_${crypto.randomUUID()}`;
  await tx.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method,
      reference_number, resident_id, customer_id, stay_id, category,
      description, billing_period, payee_vendor, idempotency_key, status,
      reversal_of_id, invoice_id, created_by, created_at, updated_at
    ) VALUES (
      ?, 'RENT_CHARGE', ?, ?, NULL,
      NULL, ?, NULL, ?, 'RENT', ?,
      ?, NULL, NULL, 'POSTED',
      NULL, ?, ?, ?, ?
    )
  `, [
    chargeId, p.amount, p.issueDate, p.residentId, p.stayId,
    `Invoice ${p.invoiceNumber} (${p.billingPeriod})`, p.billingPeriod,
    p.invoiceId, p.actorId, p.now, p.now,
  ]);
  return chargeId;
}

/**
 * Creates an invoice in DRAFT status, optionally auto-issuing it.
 */
export async function createInvoice(
  actor: AuthenticatedUser,
  input: CreateInvoiceInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<Invoice> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.invoice_created" });

  const invoiceCategory: InvoiceCategory = input.invoiceCategory === "TIFFIN" ? "TIFFIN" : "RESIDENT";
  const invoiceType: InvoiceType = input.invoiceType === "GST_TAX_INVOICE" ? "GST_TAX_INVOICE" : "REGULAR_BILL";

  const issueDate = input.issueDate?.trim();
  const dueDate = input.dueDate?.trim();
  const billingPeriod = input.billingPeriod?.trim();

  if (!issueDate || !DATE_REGEX.test(issueDate)) {
    throw new Error("Valid issue date in YYYY-MM-DD format is required.");
  }
  if (!dueDate || !DATE_REGEX.test(dueDate)) {
    throw new Error("Valid due date in YYYY-MM-DD format is required.");
  }
  if (!billingPeriod) {
    throw new Error("Billing period (e.g. 'October 2026') is required.");
  }

  // Company billing configuration
  const companyConfig = await getInvoiceCompanyConfig(db);

  // Strict PRD Guard: GST_TAX_INVOICE requires authentic registered GSTIN
  if (invoiceType === "GST_TAX_INVOICE") {
    if (!companyConfig.companyGstin || companyConfig.companyGstin.trim().length === 0) {
      throw new Error(
        "GST tax invoices require a registered company GSTIN. Configure ERP_COMPANY_GSTIN or issue as a Regular Non-GST Bill."
      );
    }
    assertValidGstin(companyConfig.companyGstin, {
      fieldName: "Company GSTIN (ERP_COMPANY_GSTIN)",
      expectedStateCode: companyConfig.companyStateCode,
    });
  }

  let residentId: string | null = null;
  let customerId: string | null = null;
  let subscriptionId: string | null = input.subscriptionId?.trim() || null;
  let stayId: string | null = null;

  let recipientName = "";
  let recipientPhone = "";
  let recipientEmail: string | null = null;
  let recipientAddress: string | null = null;
  let recipientGstin: string | null = null;
  let recipientStateCode = input.recipientStateCode?.trim() || "06";

  if (invoiceCategory === "TIFFIN") {
    customerId = input.customerId?.trim() || null;
    if (!customerId) {
      throw new Error("Customer ID is required for Tiffin invoices.");
    }
    const customer = await db.queryOne<{
      id: string;
      fullName: string;
      phone: string;
      deliveryAddress: string;
    }>(
      "SELECT id, full_name as fullName, phone, delivery_address as deliveryAddress FROM tiffin_customers WHERE id = ?",
      [customerId]
    );
    if (!customer) {
      throw new Error(`Customer '${customerId}' not found.`);
    }
    recipientName = input.recipientName?.trim() || customer.fullName;
    recipientPhone = input.recipientPhone?.trim() || customer.phone;
    recipientEmail = input.recipientEmail?.trim() || null;
    recipientAddress = input.recipientAddress?.trim() || customer.deliveryAddress;
    recipientGstin = input.recipientGstin?.trim() || null;
  } else {
    residentId = input.residentId?.trim() || null;
    if (!residentId) {
      throw new Error("Resident ID is required.");
    }

    // Fetch resident details
    const resident = await db.queryOne<{
      id: string;
      fullName: string;
      phone: string;
      email: string | null;
    }>(
      "SELECT id, full_name as fullName, phone, email FROM residents WHERE id = ?",
      [residentId]
    );
    if (!resident) {
      throw new Error(`Resident '${residentId}' not found.`);
    }

    // Resolve stay and room
    stayId = input.stayId?.trim() || null;
    if (!stayId) {
      const activeStay = await db.queryOne<{ id: string }>(
        "SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE' LIMIT 1",
        [residentId]
      );
      if (activeStay) {
        stayId = activeStay.id;
      }
    }

    // Recipient snapshots (default to resident info)
    recipientName = input.recipientName?.trim() || resident.fullName;
    recipientPhone = input.recipientPhone?.trim() || resident.phone;
    recipientEmail = input.recipientEmail?.trim() || resident.email;
    recipientAddress = input.recipientAddress?.trim() || null;
    recipientGstin = input.recipientGstin?.trim() || null;
  }

  // Recipient GSTIN validation (if provided)
  if (recipientGstin) {
    recipientGstin = assertValidGstin(recipientGstin, {
      fieldName: "Recipient GSTIN",
    });
    if (!input.recipientStateCode) {
      recipientStateCode = recipientGstin.slice(0, 2);
    }
  }

  // Calculate totals and taxes
  const calculated = calculateInvoiceTotals(
    input.items,
    invoiceType,
    companyConfig.companyStateCode,
    recipientStateCode
  );

  const invoiceId = `inv_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  let finalInvoiceNumber: string | null = null;
  let finalStatus: InvoiceStatus = "DRAFT";
  let linkedChargeId: string | null = null;
  // One invoice per invoice-creation operation (migration 0020): the form sends the same key for a
  // double click or a network retry, and the retry returns the invoice the first request created.
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const withMonth = await hasInvoiceIdempotencySchema(db);
  let replayedId: string | null = null;

  try {
  await db.transaction(async (tx) => {
    if (idempotencyKey && withMonth) {
      await acquireLedgerKeyLock(tx, `invoice:${idempotencyKey}`);
      const prior = await tx.queryOne<{ id: string; invoice_category: string; resident_id: string | null; customer_id: string | null; total_amount: number | string; billing_period: string }>(
        "SELECT id, invoice_category, resident_id, customer_id, total_amount, billing_period FROM invoices WHERE idempotency_key = ?",
        [idempotencyKey]
      );
      if (prior) {
        if (
          prior.invoice_category !== invoiceCategory ||
          (prior.resident_id ?? null) !== (residentId ?? null) ||
          (prior.customer_id ?? null) !== (customerId ?? null) ||
          Number(prior.total_amount) !== calculated.totalAmount ||
          prior.billing_period !== billingPeriod
        ) {
          throw new Error("This invoice request was already used for a different invoice. Close the form and create the invoice again.");
        }
        replayedId = prior.id;
        return;
      }
    }
    // If autoIssue requested, assign sequential invoice number and integrate with ledger
    if (input.autoIssue) {
      const year = parseInt(issueDate.slice(0, 4), 10);
      finalInvoiceNumber = await generateNextInvoiceNumber(year, tx);
      finalStatus = "ISSUED";

      // Ledger Linkage / Creation:
      if (invoiceCategory === "TIFFIN") {
        let existingCharge: { id: string; amount: number } | null = null;
        if (input.linkExistingCharge !== false) {
          existingCharge = await tx.queryOne<{ id: string; amount: number }>(`
            SELECT id, amount
            FROM financial_transactions
            WHERE customer_id = ?
              AND billing_period = ?
              AND transaction_type = 'TIFFIN_CHARGE'
              AND status = 'POSTED'
              AND invoice_id IS NULL
            LIMIT 1
          `, [customerId, billingPeriod]);
        }

        if (existingCharge) {
          linkedChargeId = existingCharge.id;
          await tx.execute(`
            UPDATE financial_transactions
            SET invoice_id = ?, updated_at = ?
            WHERE id = ?
          `, [invoiceId, now, existingCharge.id]);
        } else {
          await assertClosingDateNotFinalized(tx, issueDate, "TIFFIN");
          linkedChargeId = `txn_${crypto.randomUUID()}`;
          await tx.execute(`
            INSERT INTO financial_transactions (
              id, transaction_type, amount, transaction_date, payment_method,
              reference_number, resident_id, customer_id, stay_id, category,
              description, billing_period, payee_vendor, idempotency_key, status,
              reversal_of_id, invoice_id, created_by, created_at, updated_at
            ) VALUES (
              ?, 'TIFFIN_CHARGE', ?, ?, NULL,
              NULL, NULL, ?, NULL, 'TIFFIN',
              ?, ?, NULL, NULL, 'POSTED',
              NULL, ?, ?, ?, ?
            )
          `, [
            linkedChargeId,
            calculated.totalAmount,
            issueDate,
            customerId,
            `Tiffin Invoice ${finalInvoiceNumber} (${billingPeriod})`,
            billingPeriod,
            invoiceId,
            actor.id,
            now,
            now,
          ]);
        }
      } else {
        linkedChargeId = await resolveResidentRentCharge(tx, {
          invoiceId,
          residentId: residentId!,
          stayId,
          billingPeriod,
          amount: calculated.totalAmount,
          issueDate,
          invoiceNumber: finalInvoiceNumber!,
          linkExisting: input.linkExistingCharge !== false,
          actorId: actor.id,
          now,
        });
      }
    }

    // Insert invoice header
    await tx.execute(`
      INSERT INTO invoices (
        id, invoice_number, invoice_type, invoice_category, status, resident_id,
        customer_id, subscription_id, stay_id, issue_date, due_date, billing_period, subtotal,
        cgst_amount, sgst_amount, igst_amount, total_tax, total_amount,
        amount_paid, balance_due, company_name, company_address, company_gstin,
        company_state_code, recipient_name, recipient_phone, recipient_email, recipient_address,
        recipient_gstin, recipient_state_code, rent_charge_id, notes, cancelled_at,
        cancellation_reason, created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        0, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, NULL,
        NULL, ?, ?, ?
      )
    `, [
      invoiceId,
      finalInvoiceNumber,
      invoiceType,
      invoiceCategory,
      finalStatus,
      residentId,
      customerId,
      subscriptionId,
      stayId,
      issueDate,
      dueDate,
      billingPeriod,
      calculated.subtotal,
      calculated.cgstAmount,
      calculated.sgstAmount,
      calculated.igstAmount,
      calculated.totalTax,
      calculated.totalAmount,
      calculated.totalAmount, // balance_due initially equals total_amount
      companyConfig.companyName,
      companyConfig.companyAddress,
      companyConfig.companyGstin,
      companyConfig.companyStateCode,
      recipientName,
      recipientPhone,
      recipientEmail,
      recipientAddress,
      recipientGstin,
      recipientStateCode,
      linkedChargeId,
      input.notes?.trim() || null,
      actor.id,
      now,
      now,
    ]);
    if (withMonth) {
      // The unique indexes of migration 0020 apply here: one invoice per key, and one active tiffin
      // invoice per customer, subscription and month.
      await tx.execute("UPDATE invoices SET idempotency_key = ?, billing_month = ? WHERE id = ?", [
        idempotencyKey,
        canonicalBillingMonth(billingPeriod),
        invoiceId,
      ]);
    }

    // Insert invoice items
    for (const item of calculated.items) {
      const itemId = `inv_item_${crypto.randomUUID()}`;
      await tx.execute(`
        INSERT INTO invoice_items (
          id, invoice_id, subscription_id, service_start_date, service_end_date,
          description, sac_hsn_code, quantity,
          unit_price, amount, tax_rate, cgst_rate, sgst_rate,
          igst_rate, cgst_amount, sgst_amount, igst_amount, total_item_amount,
          created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?
        )
      `, [
        itemId,
        invoiceId,
        subscriptionId,
        null,
        null,
        item.description,
        item.sacHsnCode,
        item.quantity,
        item.unitPrice,
        item.amount,
        item.taxRate,
        item.cgstRate,
        item.sgstRate,
        item.igstRate,
        item.cgstAmount,
        item.sgstAmount,
        item.igstAmount,
        item.totalItemAmount,
        now,
      ]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: finalStatus === "ISSUED" ? "finance.invoice_issued" : "finance.invoice_created",
      targetType: "invoice",
      targetId: invoiceId,
      metadata: {
        invoiceNumber: finalInvoiceNumber,
        invoiceType,
        residentId,
        billingPeriod,
        totalAmount: calculated.totalAmount,
        autoIssue: Boolean(input.autoIssue),
      },
      ipAddress: clientIp,
    }, tx);
  });
  } catch (err: any) {
    // Migration 0020's unique index refused a second active tiffin invoice for the same
    // subscription and month (a request that raced past the checks above): nothing was written.
    if (/idx_invoices_tiffin_sub_month/.test(String(err?.message ?? ""))) {
      throw new Error("This subscription already has an active invoice for that month.");
    }
    throw err;
  }

  return (await getInvoiceById(actor, replayedId ?? invoiceId, db))!;
}

/**
 * Issues a draft invoice, assigning the next sequential invoice number and integrating with the financial ledger.
 */
export async function issueInvoice(
  actor: AuthenticatedUser,
  invoiceId: string,
  options?: { linkExistingCharge?: boolean },
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<Invoice> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.invoice_issued" });

  const existing = await getInvoiceById(actor, invoiceId, db);
  if (!existing) {
    throw new Error(`Invoice '${invoiceId}' not found.`);
  }

  if (existing.status !== "DRAFT") {
    throw new Error(
      `Cannot issue invoice '${invoiceId}'. Only DRAFT invoices can be issued. Current status is ${existing.status}.`
    );
  }

  // Company billing configuration
  const companyConfig = await getInvoiceCompanyConfig(db);

  // Strict GST guard
  if (existing.invoiceType === "GST_TAX_INVOICE") {
    if (!companyConfig.companyGstin || companyConfig.companyGstin.trim().length === 0) {
      throw new Error(
        "GST tax invoices require a registered company GSTIN. Configure ERP_COMPANY_GSTIN or issue as a Regular Non-GST Bill."
      );
    }
    assertValidGstin(companyConfig.companyGstin, {
      fieldName: "Company GSTIN (ERP_COMPANY_GSTIN)",
      expectedStateCode: companyConfig.companyStateCode,
    });
  }

  const now = new Date().toISOString();
  const year = parseInt(existing.issueDate.slice(0, 4), 10);
  let assignedNumber = "";
  let linkedChargeId: string | null = null;

  await db.transaction(async (tx) => {
    // Re-checked under the row lock: two concurrent issues of the same draft cannot both take a
    // number and post a charge.
    const locked = await tx.queryOne<{ status: string }>(
      `SELECT status FROM invoices WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [invoiceId]
    );
    if (!locked || locked.status !== "DRAFT") {
      throw new Error(
        `Cannot issue invoice '${invoiceId}'. Only DRAFT invoices can be issued. Current status is ${locked?.status ?? "missing"}.`
      );
    }
    assignedNumber = await generateNextInvoiceNumber(year, tx);

    // Ledger Linkage / Creation:
    let existingCharge: { id: string; amount: number } | null = null;
    if (existing.invoiceCategory === "TIFFIN") {
      if (options?.linkExistingCharge !== false) {
        existingCharge = await tx.queryOne<{ id: string; amount: number }>(`
          SELECT id, amount
          FROM financial_transactions
          WHERE customer_id = ?
            AND billing_period = ?
            AND transaction_type = 'TIFFIN_CHARGE'
            AND status = 'POSTED'
            AND invoice_id IS NULL
          LIMIT 1
        `, [existing.customerId, existing.billingPeriod]);
      }

      if (existingCharge) {
        linkedChargeId = existingCharge.id;
        await tx.execute(`
          UPDATE financial_transactions
          SET invoice_id = ?, updated_at = ?
          WHERE id = ?
        `, [invoiceId, now, existingCharge.id]);
      } else {
        await assertClosingDateNotFinalized(tx, existing.issueDate, "TIFFIN");
        linkedChargeId = `txn_${crypto.randomUUID()}`;
        await tx.execute(`
          INSERT INTO financial_transactions (
            id, transaction_type, amount, transaction_date, payment_method,
            reference_number, resident_id, customer_id, stay_id, category,
            description, billing_period, payee_vendor, idempotency_key, status,
            reversal_of_id, invoice_id, created_by, created_at, updated_at
          ) VALUES (
            ?, 'TIFFIN_CHARGE', ?, ?, NULL,
            NULL, NULL, ?, NULL, 'TIFFIN',
            ?, ?, NULL, NULL, 'POSTED',
            NULL, ?, ?, ?, ?
          )
        `, [
          linkedChargeId,
          existing.totalAmount,
          existing.issueDate,
          existing.customerId,
          `Tiffin Invoice ${assignedNumber} (${existing.billingPeriod})`,
          existing.billingPeriod,
          invoiceId,
          actor.id,
          now,
          now,
        ]);
      }
    } else {
      linkedChargeId = await resolveResidentRentCharge(tx, {
        invoiceId,
        residentId: existing.residentId!,
        stayId: existing.stayId ?? null,
        billingPeriod: existing.billingPeriod,
        amount: existing.totalAmount,
        issueDate: existing.issueDate,
        invoiceNumber: assignedNumber,
        linkExisting: options?.linkExistingCharge !== false,
        actorId: actor.id,
        now,
      });
    }

    // Update invoice header
    await tx.execute(`
      UPDATE invoices
      SET invoice_number = ?,
          status = 'ISSUED',
          rent_charge_id = ?,
          updated_at = ?
      WHERE id = ?
    `, [assignedNumber, linkedChargeId, now, invoiceId]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.invoice_issued",
      targetType: "invoice",
      targetId: invoiceId,
      metadata: {
        invoiceNumber: assignedNumber,
        rentChargeId: linkedChargeId,
        totalAmount: existing.totalAmount,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getInvoiceById(actor, invoiceId, db))!;
}

/**
 * Allocates a posted resident rent payment to an issued or partially paid invoice.
 */
export async function allocatePaymentToInvoice(
  actor: AuthenticatedUser,
  input: AllocatePaymentInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb,
  /** The allocation of a payment being recorded right now for this invoice (recordTiffinPayment). */
  options?: { asPartOfPayment?: boolean }
): Promise<{ invoice: Invoice; allocation: InvoicePaymentAllocation }> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  // Re-allocating existing payments is Owner work (finance.manage); applying a payment to the
  // invoice it is being recorded for belongs to recording it (finance.record).
  requirePermission(actor, options?.asPartOfPayment ? "finance.record" : "finance.manage", { ip: clientIp, action: "finance.payment_allocated" });

  const allocationId = `inv_alloc_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let invoiceIdForResult = input.invoiceId;

  // Every check runs inside the transaction on locked rows, payment first and then invoice (the
  // order a payment reversal uses), so concurrent allocations against the same payment or the same
  // invoice are applied one after another and each sees the other's result.
  await db.transaction(async (tx) => {
    const lock = tx.isPostgres ? " FOR UPDATE" : "";
    const payment = await tx.queryOne<{
      id: string;
      transaction_type: string;
      amount: number | string;
      resident_id: string | null;
      customer_id: string | null;
      status: string;
    }>(
      `SELECT id, transaction_type, amount, resident_id, customer_id, status FROM financial_transactions WHERE id = ?${lock}`,
      [input.paymentTransactionId]
    );
    const invoice = await tx.queryOne<{
      id: string;
      invoice_number: string | null;
      invoice_category: string;
      status: InvoiceStatus;
      resident_id: string | null;
      customer_id: string | null;
      amount_paid: number | string;
      balance_due: number | string;
    }>(
      `SELECT id, invoice_number, invoice_category, status, resident_id, customer_id, amount_paid, balance_due FROM invoices WHERE id = ?${lock}`,
      [input.invoiceId]
    );

    if (!invoice) {
      throw new Error(`Invoice '${input.invoiceId}' not found.`);
    }
    invoiceIdForResult = invoice.id;
    if (invoice.status !== "ISSUED" && invoice.status !== "PARTIALLY_PAID") {
      throw new Error(
        `Payments can only be allocated to ISSUED or PARTIALLY_PAID invoices. Current status is ${invoice.status}.`
      );
    }
    const amountPaid = Number(invoice.amount_paid);
    const balanceDue = Number(invoice.balance_due);
    if (balanceDue <= 0) {
      throw new Error(`Invoice '${invoice.invoice_number || invoice.id}' is already fully paid.`);
    }

    if (!payment) {
      throw new Error(`Payment transaction '${input.paymentTransactionId}' not found.`);
    }
    if (payment.status !== "POSTED") {
      throw new Error(`Cannot allocate reversed payment '${input.paymentTransactionId}'.`);
    }
    if (invoice.invoice_category === "TIFFIN") {
      if (payment.transaction_type !== "TIFFIN_PAYMENT") {
        throw new Error(`Transaction '${input.paymentTransactionId}' is not a TIFFIN_PAYMENT (got ${payment.transaction_type}).`);
      }
      if (payment.customer_id !== invoice.customer_id) {
        throw new Error("Payment transaction does not belong to the invoice recipient customer.");
      }
    } else {
      if (payment.transaction_type !== "RENT_PAYMENT") {
        throw new Error(`Transaction '${input.paymentTransactionId}' is not a RENT_PAYMENT (got ${payment.transaction_type}).`);
      }
      if (payment.resident_id !== invoice.resident_id) {
        throw new Error("Payment transaction does not belong to the invoice recipient resident.");
      }
    }

    // A posted payment's allocations are all active (they stop counting only when the payment is
    // reversed, and a reversed payment cannot be allocated).
    const allocRes = await tx.queryOne<{ totalAllocated: number | string }>(`
      SELECT COALESCE(SUM(amount), 0) as "totalAllocated"
      FROM invoice_payment_allocations
      WHERE payment_transaction_id = ?
    `, [input.paymentTransactionId]);
    const remainingPayment = Number(payment.amount) - Number(allocRes?.totalAllocated || 0);
    if (remainingPayment <= 0) {
      throw new Error(`Payment transaction '${input.paymentTransactionId}' has already been fully allocated to invoices.`);
    }

    let amountToAllocate: number;
    if (input.amount !== undefined && input.amount !== null) {
      const specified = Number(input.amount);
      if (!Number.isInteger(specified) || specified <= 0) {
        throw new Error("Allocation amount must be a positive integer in INR.");
      }
      if (specified > remainingPayment) {
        throw new Error(
          `Cannot allocate ₹${specified.toLocaleString("en-IN")}. Payment only has ₹${remainingPayment.toLocaleString("en-IN")} unallocated remaining.`
        );
      }
      if (specified > balanceDue) {
        throw new Error(
          `Cannot allocate ₹${specified.toLocaleString("en-IN")}. Invoice balance due is only ₹${balanceDue.toLocaleString("en-IN")}.`
        );
      }
      amountToAllocate = specified;
    } else {
      amountToAllocate = Math.min(remainingPayment, balanceDue);
    }

    await tx.execute(`
      INSERT INTO invoice_payment_allocations (
        id, invoice_id, payment_transaction_id, amount, allocated_at,
        allocated_by, notes, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `, [
      allocationId,
      invoice.id,
      input.paymentTransactionId,
      amountToAllocate,
      now,
      actor.id,
      input.notes?.trim() || null,
      now,
    ]);

    const newAmountPaid = amountPaid + amountToAllocate;
    const newBalanceDue = balanceDue - amountToAllocate;
    const newStatus: InvoiceStatus = newBalanceDue === 0 ? "PAID" : "PARTIALLY_PAID";

    await tx.execute(`
      UPDATE invoices
      SET amount_paid = ?,
          balance_due = ?,
          status = ?,
          updated_at = ?
      WHERE id = ?
    `, [newAmountPaid, newBalanceDue, newStatus, now, invoice.id]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.payment_allocated",
      targetType: "invoice",
      targetId: invoice.id,
      metadata: {
        allocationId,
        paymentTransactionId: input.paymentTransactionId,
        amount: amountToAllocate,
        newBalanceDue,
        newStatus,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedInvoice = (await getInvoiceById(actor, invoiceIdForResult, db))!;
  const allocation = updatedInvoice.allocations?.find((a) => a.id === allocationId)!;

  return { invoice: updatedInvoice, allocation };
}

/**
 * Cancels an invoice.
 * An invoice can only be cancelled if it has no allocated payments (amountPaid === 0).
 */
export async function cancelInvoice(
  actor: AuthenticatedUser,
  invoiceId: string,
  reason: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<Invoice> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "finance.manage", { ip: clientIp, action: "finance.invoice_cancelled" });

  const cleanReason = reason?.trim();
  if (!cleanReason || cleanReason.length < 5) {
    throw new Error("A clear cancellation reason of at least 5 characters is required.");
  }

  const existing = await getInvoiceById(actor, invoiceId, db);
  if (!existing) {
    throw new Error(`Invoice '${invoiceId}' not found.`);
  }

  if (existing.status === "CANCELLED") {
    throw new Error(`Invoice '${invoiceId}' is already cancelled.`);
  }

  if (existing.amountPaid > 0) {
    throw new Error(
      `Cannot cancel invoice with allocated payments (₹${existing.amountPaid.toLocaleString("en-IN")} allocated). Deallocate or reverse payments first.`
    );
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    // Enforce closing lock: if the invoice issue date is finalized, reject retroactive cancellation
    const invDivision: ClosingDivision = existing.invoiceCategory === "TIFFIN" ? "TIFFIN" : "PG";
    await assertClosingDateNotFinalized(tx, existing.issueDate, invDivision);

    // If Tiffin invoice, release any linked delivery tasks so they can be re-billed
    // and reverse linked TIFFIN_CHARGE so it does not remain as phantom receivable
    if (existing.invoiceCategory === "TIFFIN") {
      await tx.execute(`
        UPDATE delivery_tasks
        SET invoice_id = NULL, invoice_item_id = NULL, billed_at = NULL, updated_at = ?
        WHERE invoice_id = ?
      `, [now, invoiceId]);

      if (existing.rentChargeId) {
        await tx.execute(`
          UPDATE financial_transactions
          SET status = 'REVERSED', updated_at = ?
          WHERE id = ?
        `, [now, existing.rentChargeId]);
      } else {
        await tx.execute(`
          UPDATE financial_transactions
          SET status = 'REVERSED', updated_at = ?
          WHERE invoice_id = ? AND transaction_type = 'TIFFIN_CHARGE' AND status = 'POSTED'
        `, [now, invoiceId]);
      }
    } else if (existing.rentChargeId) {
      // For resident invoices, decouple the existing rent charge so it can be re-invoiced
      await tx.execute(`
        UPDATE financial_transactions
        SET invoice_id = NULL, updated_at = ?
        WHERE id = ?
      `, [now, existing.rentChargeId]);
    }

    const updateRes = await tx.execute(`
      UPDATE invoices
      SET status = 'CANCELLED',
          cancelled_at = ?,
          cancellation_reason = ?,
          rent_charge_id = NULL,
          updated_at = ?
      WHERE id = ? AND status != 'CANCELLED'
    `, [now, cleanReason, now, invoiceId]);

    if (updateRes.changes === 0) {
      throw new Error(`Invoice '${existing.invoiceNumber || invoiceId}' is already cancelled.`);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "finance.invoice_cancelled",
      targetType: "invoice",
      targetId: invoiceId,
      metadata: {
        invoiceNumber: existing.invoiceNumber,
        reason: cleanReason,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getInvoiceById(actor, invoiceId, db))!;
}

/**
 * Retrieves a single invoice by ID, complete with line items and payment allocations.
 */
export async function getInvoiceById(
  actor: AuthenticatedUser,
  invoiceId: string,
  asyncDb?: AsyncDb
): Promise<Invoice | null> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "finance.read");

  const row = await db.queryOne<any>(`
    SELECT
      i.*,
      r.full_name as resident_name,
      tc.full_name as customer_name,
      rm.room_number
    FROM invoices i
    LEFT JOIN residents r ON i.resident_id = r.id
    LEFT JOIN tiffin_customers tc ON i.customer_id = tc.id
    LEFT JOIN resident_stays s ON i.stay_id = s.id
    LEFT JOIN rooms rm ON s.room_id = rm.id
    WHERE i.id = ?
  `, [invoiceId]);

  if (!row) {
    return null;
  }

  // Load items
  const itemRows = await db.query<any>(`
    SELECT *
    FROM invoice_items
    WHERE invoice_id = ?
    ORDER BY created_at ASC
  `, [invoiceId]);
  const items = itemRows.map(mapRowToItem);

  // Load allocations
  const allocRows = await db.query<any>(`
    SELECT
      a.*,
      t.transaction_date as payment_date,
      t.payment_method,
      t.reference_number,
      t.status as payment_status,
      u.full_name as allocated_by_name
    FROM invoice_payment_allocations a
    LEFT JOIN financial_transactions t ON a.payment_transaction_id = t.id
    LEFT JOIN staff_users u ON a.allocated_by = u.id
    WHERE a.invoice_id = ?
    ORDER BY a.allocated_at ASC
  `, [invoiceId]);
  const allocations = allocRows.map(mapRowToAllocation);

  return mapRowToInvoice(row, items, allocations);
}

export interface ListInvoicesOptions {
  residentId?: string;
  customerId?: string;
  invoiceCategory?: InvoiceCategory;
  status?: InvoiceStatus;
  invoiceType?: InvoiceType;
  billingPeriod?: string;
  limit?: number;
  offset?: number;
}

/**
 * Lists invoices with optional filters for resident, status, type, and billing period.
 */
export async function listInvoices(
  actor: AuthenticatedUser,
  options: ListInvoicesOptions = {},
  asyncDb?: AsyncDb
): Promise<{ invoices: Invoice[]; total: number }> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "finance.read");

  const conditions: string[] = [];
  const params: any[] = [];

  if (options.residentId) {
    conditions.push("i.resident_id = ?");
    params.push(options.residentId);
  }

  if (options.customerId) {
    conditions.push("i.customer_id = ?");
    params.push(options.customerId);
  }

  if (options.invoiceCategory) {
    conditions.push("i.invoice_category = ?");
    params.push(options.invoiceCategory);
  }

  if (options.status) {
    conditions.push("i.status = ?");
    params.push(options.status);
  }

  if (options.invoiceType) {
    conditions.push("i.invoice_type = ?");
    params.push(options.invoiceType);
  }

  if (options.billingPeriod) {
    conditions.push("i.billing_period = ?");
    params.push(options.billingPeriod);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = await db.queryOne<{ count: number | string }>(`
    SELECT COUNT(*) as count
    FROM invoices i
    ${whereClause}
  `, params);

  const total = Number(countRow?.count || 0);

  const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await db.query<any>(`
    SELECT
      i.*,
      r.full_name as resident_name,
      tc.full_name as customer_name,
      rm.room_number,
      u.full_name as created_by_name
    FROM invoices i
    LEFT JOIN residents r ON i.resident_id = r.id
    LEFT JOIN tiffin_customers tc ON i.customer_id = tc.id
    LEFT JOIN resident_stays s ON i.stay_id = s.id
    LEFT JOIN rooms rm ON s.room_id = rm.id
    LEFT JOIN staff_users u ON i.created_by = u.id
    ${whereClause}
    ORDER BY i.issue_date DESC, i.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const invoices = rows.map((r) => mapRowToInvoice(r));

  return { invoices, total };
}

/**
 * Returns posted rent payments for a resident that still have unallocated balances available.
 */
export async function getUnallocatedPaymentsForResident(
  actor: AuthenticatedUser,
  residentId: string,
  asyncDb?: AsyncDb
): Promise<Array<{
  paymentId: string;
  transactionDate: string;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  paymentMethod: string | null;
  referenceNumber: string | null;
}>> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "finance.read");

  const rows = await db.query<any>(`
    SELECT
      t.id,
      t.transaction_date,
      t.amount,
      t.payment_method,
      t.reference_number,
      COALESCE(SUM(a.amount), 0) as allocated_amount
    FROM financial_transactions t
    LEFT JOIN invoice_payment_allocations a ON t.id = a.payment_transaction_id
    WHERE t.resident_id = ?
      AND t.transaction_type = 'RENT_PAYMENT'
      AND t.status = 'POSTED'
    GROUP BY t.id, t.transaction_date, t.amount, t.payment_method, t.reference_number
    ORDER BY t.transaction_date ASC
  `, [residentId]);

  return rows
    .map((r) => {
      const amount = Number(r.amount);
      const allocated = Number(r.allocated_amount);
      return {
        paymentId: r.id,
        transactionDate: r.transaction_date,
        amount,
        allocatedAmount: allocated,
        unallocatedAmount: Math.max(0, amount - allocated),
        paymentMethod: r.payment_method,
        referenceNumber: r.reference_number,
      };
    })
    .filter((p) => p.unallocatedAmount > 0);
}
