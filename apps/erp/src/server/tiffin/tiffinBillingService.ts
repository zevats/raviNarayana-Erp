import { hasDeliveryOpsSchema } from "../delivery/deliveryRules";
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { getCompanyBillingConfig } from "../database/env";
import { assertClosingDateNotFinalized, acquireLedgerKeyLock } from "../finance/financeService";
import { assertValidGstin } from "../finance/gstinValidator";
import {
  generateNextInvoiceNumber,
  calculateInvoiceTotals,
  getInvoiceById,
  allocatePaymentToInvoice,
} from "../finance/invoiceService";
import {
  AuthenticatedUser,
  Invoice,
  InvoiceStatus,
  InvoiceType,
  FinancialTransaction,
  PaymentMethod,
  TiffinBillingCustomerPreview,
  TiffinBillingPeriodPreview,
  GenerateTiffinInvoicesInput,
  GenerateTiffinInvoicesResult,
  RecordTiffinPaymentInput,
  TiffinCustomerBalanceSummary,
  MealType,
  CustomerType,
  SubscriptionStatus,
  BillingUnit,
  SubscriptionMealTypes,
  SubscriptionServiceDays,
  normalizePaymentMethod,
  CANONICAL_PAYMENT_METHODS,
  PrepaidExceptionResolution,
  PrepaidBillingExceptionItem,
  GetPrepaidBillingExceptionsOptions,
  PrepaidBillingExceptionsSummary,
  ReconcilePrepaidExceptionInput,
  ReconcilePrepaidExceptionResult,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PAYMENT_METHODS: readonly PaymentMethod[] = CANONICAL_PAYMENT_METHODS;

export interface PreviewTiffinBillingOptions {
  billingPeriod: string;
  startDate: string;
  endDate: string;
  customerId?: string;
}

/**
 * Previews Tiffin customer billing eligibility, delivered meal quantities,
 * pricing basis, line items, and existing invoice statuses for an accounting period.
 * Requires finance.read or tiffin.read permission.
 */
export async function previewTiffinBilling(
  actor: AuthenticatedUser,
  options: PreviewTiffinBillingOptions,
  asyncDb?: AsyncDb
): Promise<TiffinBillingPeriodPreview> {
  const db = asyncDb ?? getAsyncDb();

  // RBAC: Operations Manager, Accountant, Super Admin
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ACCOUNTANT" && actor.role !== "OPERATIONS_MANAGER") {
    requirePermission(actor, "finance.read");
  }

  const startDate = options.startDate?.trim();
  const endDate = options.endDate?.trim();
  const billingPeriod = options.billingPeriod?.trim();

  if (!startDate || !DATE_REGEX.test(startDate)) {
    throw new Error("Valid start date in YYYY-MM-DD format is required.");
  }
  if (!endDate || !DATE_REGEX.test(endDate)) {
    throw new Error("Valid end date in YYYY-MM-DD format is required.");
  }
  if (startDate > endDate) {
    throw new Error(`Start date (${startDate}) cannot be after end date (${endDate}).`);
  }
  if (!billingPeriod) {
    throw new Error("Billing period (e.g. 'October 2026') is required.");
  }

  // Fetch active subscriptions overlapping the requested service period
  const subConditions: string[] = [
    "sub.start_date <= ?",
    "(sub.end_date IS NULL OR sub.end_date >= ?)",
    "sub.status IN ('ACTIVE', 'PAUSED')",
  ];
  const subParams: any[] = [endDate, startDate];

  if (options.customerId) {
    subConditions.push("sub.customer_id = ?");
    subParams.push(options.customerId);
  }

  const subRows = await db.query<any>(`
    SELECT
      sub.id as subscription_id,
      sub.customer_id,
      sub.status as subscription_status,
      sub.start_date as subscription_start_date,
      sub.end_date as subscription_end_date,
      sub.price as agreed_price,
      sub.meal_types,
      sub.service_days,
      sub.quantity_per_meal,
      sub.pause_start_date,
      sub.pause_resume_date,
      c.full_name as customer_name,
      c.phone as customer_phone,
      c.delivery_address,
      c.customer_type,
      c.status as customer_status,
      p.code as product_code,
      p.name as product_name,
      p.billing_unit,
      p.category as product_category
    FROM tiffin_subscriptions sub
    JOIN tiffin_customers c ON c.id = sub.customer_id
    JOIN tiffin_products p ON p.id = sub.product_id
    WHERE ${subConditions.join(" AND ")}
    ORDER BY c.full_name ASC, sub.start_date ASC
  `, subParams);

  const customerPreviews: TiffinBillingCustomerPreview[] = [];
  let totalEligibleCustomers = 0;
  let totalBillableDeliveredMeals = 0;
  let totalProjectedAmount = 0;
  let alreadyBilledInvoicesCount = 0;

  const itemLines = await hasDeliveryOpsSchema(db);
  for (const row of subRows) {
    const subscriptionId = row.subscription_id;
    const customerId = row.customer_id;
    const agreedPrice = Number(row.agreed_price);
    const quantityPerMeal = Number(row.quantity_per_meal || 1);
    const billingUnit = row.billing_unit as BillingUnit;

    // Check if an invoice already exists for this customer, subscription, and billing period
    const existingInvoice = await db.queryOne<any>(`
      SELECT id, invoice_number, status, total_amount, amount_paid, balance_due
      FROM invoices
      WHERE customer_id = ?
        AND subscription_id = ?
        AND billing_period = ?
        AND status != 'CANCELLED'
      LIMIT 1
    `, [customerId, subscriptionId, billingPeriod]);

    // Query delivery tasks for this subscription in the date window
    // With item lines (migration 0014) a delivery bills the boxes actually delivered (a partial
    // delivery or an extra-today box changes it); older deliveries bill quantity_per_meal.
    const tasks = await db.query<any>(`
      SELECT
        id, service_date, meal_type, status, invoice_id,
        delivered_at, delivered_by, exception_type, exception_reason,
        ${itemLines ? "(SELECT SUM(i.delivered_quantity) FROM delivery_task_items i WHERE i.task_id = delivery_tasks.id)" : "NULL"} AS delivered_boxes
      FROM delivery_tasks
      WHERE subscription_id = ?
        AND service_date >= ?
        AND service_date <= ?
        AND order_type = 'EXTERNAL'
      ORDER BY service_date ASC, meal_type ASC
    `, [subscriptionId, startDate, endDate]);

    const deliveredTasks: any[] = [];
    const excludedTasks: any[] = [];
    let alreadyBilledTasksCount = 0;

    for (const t of tasks) {
      if (t.status === "DELIVERED") {
        if (t.invoice_id) {
          alreadyBilledTasksCount++;
        } else {
          deliveredTasks.push(t);
        }
      } else {
        excludedTasks.push(t);
      }
    }

    const warnings: string[] = [];
    let billableQuantity = 0;
    let subtotal = 0;

    if (billingUnit === "PER_MONTH") {
      // Monthly subscription package charge
      billableQuantity = 1;
      subtotal = agreedPrice;
      if (deliveredTasks.length === 0 && alreadyBilledTasksCount === 0) {
        warnings.push("No delivered meals found in period for this monthly package.");
      }
    } else {
      // Per-meal / per-delivery billing (e.g. Daily Tiffin)
      billableQuantity = deliveredTasks.reduce((sum, t) => sum + boxesFor(t, quantityPerMeal), 0);
      subtotal = billableQuantity * agreedPrice;
      if (deliveredTasks.length === 0 && !existingInvoice) {
        warnings.push("0 delivered meals available to bill in this date range.");
      }
    }

    if (excludedTasks.length > 0) {
      warnings.push(`${excludedTasks.length} meal delivery task(s) were excluded (undelivered or exception).`);
    }

    const alreadyBilled = !!existingInvoice;
    if (alreadyBilled) {
      alreadyBilledInvoicesCount++;
    } else {
      totalEligibleCustomers++;
      totalBillableDeliveredMeals += deliveredTasks.reduce((sum, t) => sum + boxesFor(t, quantityPerMeal), 0);
      totalProjectedAmount += subtotal;
    }

    customerPreviews.push({
      customerId,
      customerName: row.customer_name,
      phone: row.customer_phone,
      deliveryAddress: row.delivery_address,
      customerType: row.customer_type as CustomerType,
      subscriptionId,
      subscriptionStatus: row.subscription_status as SubscriptionStatus,
      productCode: row.product_code,
      productName: row.product_name,
      billingUnit,
      unitPrice: agreedPrice,
      mealTypes: row.meal_types as SubscriptionMealTypes,
      serviceDays: row.service_days as SubscriptionServiceDays,
      deliveredCount: deliveredTasks.length,
      excludedCount: excludedTasks.length,
      alreadyBilledCount: alreadyBilledTasksCount,
      billableQuantity,
      subtotal,
      taxAmount: 0,
      totalAmount: subtotal,
      existingInvoiceId: existingInvoice?.id || null,
      existingInvoiceNumber: existingInvoice?.invoice_number || null,
      existingInvoiceStatus: (existingInvoice?.status as InvoiceStatus) || null,
      alreadyBilled,
      warnings,
      billableTasks: deliveredTasks.map((t) => ({
        taskId: t.id,
        serviceDate: t.service_date,
        mealType: t.meal_type as MealType,
        deliveredAt: t.delivered_at,
        deliveredBy: t.delivered_by || null,
      })),
    });
  }

  return {
    billingPeriod,
    startDate,
    endDate,
    totalEligibleCustomers,
    totalBillableDeliveredMeals,
    totalProjectedAmount,
    alreadyBilledInvoicesCount,
    customers: customerPreviews,
  };
}

/**
 * Atomically generates Tiffin invoices for eligible customers based on verified deliveries
 * and agreed subscription price snapshots, with strict duplicate prevention and financial ledger integration.
 * Requires finance.manage or tiffin.manage permission.
 */
export async function generateTiffinInvoices(
  actor: AuthenticatedUser,
  input: GenerateTiffinInvoicesInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<GenerateTiffinInvoicesResult> {
  const db = asyncDb ?? getAsyncDb();

  // Privilege Guard: Requires finance.manage (Super Admin, Accountant)
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "tiffin.invoices_generated" });

  const billingPeriod = input.billingPeriod?.trim();
  const startDate = input.startDate?.trim();
  const endDate = input.endDate?.trim();
  const dueDate = input.dueDate?.trim();
  const invoiceType: InvoiceType = input.invoiceType === "GST_TAX_INVOICE" ? "GST_TAX_INVOICE" : "REGULAR_BILL";

  if (!billingPeriod) {
    throw new Error("Billing period is required.");
  }
  if (!startDate || !DATE_REGEX.test(startDate)) {
    throw new Error("Valid service start date (YYYY-MM-DD) is required.");
  }
  if (!endDate || !DATE_REGEX.test(endDate)) {
    throw new Error("Valid service end date (YYYY-MM-DD) is required.");
  }
  if (!dueDate || !DATE_REGEX.test(dueDate)) {
    throw new Error("Valid due date (YYYY-MM-DD) is required.");
  }

  // Pre-flight preview calculation
  const preview = await previewTiffinBilling(
    actor,
    { billingPeriod, startDate, endDate },
    db
  );

  const targetCustomerIds = input.customerIds && input.customerIds.length > 0
    ? new Set(input.customerIds)
    : null;

  const eligibleList = preview.customers.filter((c) => {
    if (targetCustomerIds && !targetCustomerIds.has(c.customerId)) {
      return false;
    }
    return true;
  });

  const companyConfig = getCompanyBillingConfig();

  // GST guard
  if (invoiceType === "GST_TAX_INVOICE") {
    if (!companyConfig.companyGstin || companyConfig.companyGstin.trim().length === 0) {
      throw new Error("GST tax invoices require a registered company GSTIN. Configure ERP_COMPANY_GSTIN or generate as Regular Non-GST Bill.");
    }
    assertValidGstin(companyConfig.companyGstin, {
      fieldName: "Company GSTIN (ERP_COMPANY_GSTIN)",
      expectedStateCode: companyConfig.companyStateCode,
    });
  }

  const generatedInvoices: Invoice[] = [];
  const skippedDetails: Array<{ customerId: string; customerName: string; reason: string }> = [];
  const now = new Date().toISOString();
  const issueDate = now.slice(0, 10);
  const year = parseInt(issueDate.slice(0, 4), 10);

  await db.transaction(async (tx) => {
    if (input.autoIssue && eligibleList.length > 0) {
      await assertClosingDateNotFinalized(tx, issueDate, "TIFFIN");
    }

    for (const cust of eligibleList) {
      // 1. Concurrency-safe duplicate prevention at DB transaction level
      const existing = await tx.queryOne<any>(`
        SELECT id, invoice_number, status
        FROM invoices
        WHERE customer_id = ?
          AND subscription_id = ?
          AND billing_period = ?
          AND status != 'CANCELLED'
        LIMIT 1
      `, [cust.customerId, cust.subscriptionId, billingPeriod]);

      if (existing) {
        skippedDetails.push({
          customerId: cust.customerId,
          customerName: cust.customerName,
          reason: `Invoice ${existing.invoice_number || existing.id} already exists for ${billingPeriod} (${existing.status}).`,
        });
        continue;
      }

      // If per-meal billing and 0 delivered meals, skip
      if (cust.billingUnit !== "PER_MONTH" && cust.billableTasks.length === 0) {
        skippedDetails.push({
          customerId: cust.customerId,
          customerName: cust.customerName,
          reason: "No confirmed delivered meals in the service date window.",
        });
        continue;
      }

      // Calculate totals and tax
      const itemDescription = cust.billingUnit === "PER_MONTH"
        ? `${cust.productName} — Monthly Subscription (${billingPeriod})`
        : `${cust.productName} — ${cust.billableQuantity} Delivered Meal(s) (${startDate} to ${endDate})`;

      const calculated = calculateInvoiceTotals(
        [{
          description: itemDescription,
          quantity: cust.billableQuantity,
          unitPrice: cust.unitPrice,
          taxRate: 0,
        }],
        invoiceType,
        companyConfig.companyStateCode,
        companyConfig.companyStateCode
      );

      const invoiceId = `inv_${crypto.randomUUID()}`;
      let finalInvoiceNumber: string | null = null;
      let finalStatus: InvoiceStatus = "DRAFT";
      let linkedChargeId: string | null = null;

      if (input.autoIssue) {
        finalInvoiceNumber = await generateNextInvoiceNumber(year, tx);
        finalStatus = "ISSUED";
        linkedChargeId = `txn_${crypto.randomUUID()}`;

        // Create financial ledger charge record for Tiffin commercial revenue
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
          cust.customerId,
          `Tiffin Invoice ${finalInvoiceNumber} (${billingPeriod})`,
          billingPeriod,
          invoiceId,
          actor.id,
          now,
          now,
        ]);
      }

      // Insert invoice header
      await tx.execute(`
        INSERT INTO invoices (
          id, invoice_number, invoice_type, invoice_category, status,
          resident_id, customer_id, subscription_id, stay_id, issue_date,
          due_date, billing_period, subtotal, cgst_amount, sgst_amount,
          igst_amount, total_tax, total_amount, amount_paid, balance_due,
          company_name, company_address, company_gstin, company_state_code,
          recipient_name, recipient_phone, recipient_email, recipient_address,
          recipient_gstin, recipient_state_code, rent_charge_id, notes,
          cancelled_at, cancellation_reason, created_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'TIFFIN', ?,
          NULL, ?, ?, NULL, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, 0, ?,
          ?, ?, ?, ?,
          ?, ?, NULL, ?,
          NULL, ?, ?, ?,
          NULL, NULL, ?, ?, ?
        )
      `, [
        invoiceId,
        finalInvoiceNumber,
        invoiceType,
        finalStatus,
        cust.customerId,
        cust.subscriptionId,
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
        cust.customerName,
        cust.phone,
        cust.deliveryAddress,
        companyConfig.companyStateCode,
        linkedChargeId,
        input.notes?.trim() || null,
        actor.id,
        now,
        now,
      ]);

      // Insert line item
      const itemId = `inv_item_${crypto.randomUUID()}`;
      await tx.execute(`
        INSERT INTO invoice_items (
          id, invoice_id, subscription_id, service_start_date, service_end_date,
          description, sac_hsn_code, quantity, unit_price, amount,
          tax_rate, cgst_rate, sgst_rate, igst_rate, cgst_amount,
          sgst_amount, igst_amount, total_item_amount, created_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, NULL, ?, ?, ?,
          0, 0, 0, 0, 0,
          0, 0, ?, ?
        )
      `, [
        itemId,
        invoiceId,
        cust.subscriptionId,
        startDate,
        endDate,
        itemDescription,
        cust.billableQuantity,
        cust.unitPrice,
        calculated.subtotal,
        calculated.totalAmount,
        now,
      ]);

      // Link delivery tasks to prevent re-billing
      if (cust.billableTasks.length > 0) {
        const taskIds = cust.billableTasks.map((t) => t.taskId);
        for (const taskId of taskIds) {
          await tx.execute(`
            UPDATE delivery_tasks
            SET invoice_id = ?, invoice_item_id = ?, billed_at = ?, updated_at = ?
            WHERE id = ? AND invoice_id IS NULL AND status = 'DELIVERED'
          `, [invoiceId, itemId, now, now, taskId]);
        }
      }

      await recordAuditEventAsync({
        actorId: actor.id,
        actorUsername: actor.username,
        action: finalStatus === "ISSUED" ? "tiffin.invoice_issued" : "tiffin.invoice_created",
        targetType: "invoice",
        targetId: invoiceId,
        metadata: {
          invoiceNumber: finalInvoiceNumber,
          customerId: cust.customerId,
          subscriptionId: cust.subscriptionId,
          billingPeriod,
          totalAmount: calculated.totalAmount,
          deliveredMealsCount: cust.billableTasks.length,
          autoIssue: Boolean(input.autoIssue),
        },
        ipAddress: clientIp,
      }, tx);

      const generated = await getInvoiceById(actor, invoiceId, tx as any);
      if (generated) {
        generatedInvoices.push(generated);
      }
    }
  });

  return {
    billingPeriod,
    generatedCount: generatedInvoices.length,
    skippedCount: skippedDetails.length,
    invoices: generatedInvoices,
    skippedDetails,
  };
}

/**
 * Records a customer payment collection for Tiffin culinary service,
 * updates the financial transaction cashbook, and optionally allocates the payment against an issued invoice.
 * Requires finance.manage or tiffin.manage permission.
 */
export async function recordTiffinPayment(
  actor: AuthenticatedUser,
  input: RecordTiffinPaymentInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<{ transaction: FinancialTransaction; allocation?: any }> {
  let dbInstance = asyncDb;
  const db = dbInstance ?? getAsyncDb();

  // Privilege Guard: Requires finance.manage (Super Admin, Accountant)
  requirePermission(actor, "finance.manage", { ip: clientIp, action: "tiffin.payment_recorded" });

  const customerId = input.customerId?.trim();
  const amount = Number(input.amount);
  const transactionDate = input.transactionDate?.trim();
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const referenceNumber = input.referenceNumber?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (!customerId) {
    throw new Error("Customer ID is required.");
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Payment amount must be a positive integer in whole INR.");
  }
  if (!transactionDate || !DATE_REGEX.test(transactionDate)) {
    throw new Error("Valid transaction date in YYYY-MM-DD format is required.");
  }

  const customer = await db.queryOne<{ id: string; fullName: string }>(`
    SELECT id, full_name as "fullName" FROM tiffin_customers WHERE id = ?
  `, [customerId]);
  if (!customer) {
    throw new Error(`Customer '${customerId}' not found.`);
  }

  // Idempotency: a replayed key returns the original row; a key reused with a different payload
  // is rejected. Checked here and again under the key lock inside the transaction.
  const replayIdempotent = (existing: any): { transaction: FinancialTransaction; allocation?: any } => {
    if (
      existing.transaction_type !== "TIFFIN_PAYMENT" ||
      Number(existing.amount) !== amount ||
      existing.customer_id !== customerId ||
      existing.payment_method !== paymentMethod
    ) {
      throw new Error(
        `Idempotency key '${idempotencyKey}' was already used with a different transaction payload.`
      );
    }
    return {
      transaction: {
        id: existing.id,
        transactionType: existing.transaction_type,
        amount: Number(existing.amount),
        transactionDate: existing.transaction_date,
        paymentMethod: existing.payment_method,
        referenceNumber: existing.reference_number,
        residentId: null,
        customerId: existing.customer_id,
        stayId: null,
        category: existing.category,
        description: existing.description,
        billingPeriod: existing.billing_period,
        payeeVendor: existing.payee_vendor,
        idempotencyKey: existing.idempotency_key,
        status: existing.status,
        reversalOfId: existing.reversal_of_id,
        createdBy: existing.created_by,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      },
    };
  };
  if (idempotencyKey) {
    const existing = await db.queryOne<any>(`
      SELECT * FROM financial_transactions WHERE idempotency_key = ?
    `, [idempotencyKey]);
    if (existing) return replayIdempotent(existing);
  }
  let replayed: any = null;

  const txnId = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let allocatedResult: any = undefined;

  await db.transaction(async (tx) => {
    await assertClosingDateNotFinalized(tx, transactionDate, "TIFFIN");

    if (idempotencyKey) {
      // Concurrent duplicates serialize here; the later one replays the committed row.
      await acquireLedgerKeyLock(tx, `idempotency:${idempotencyKey}`);
      replayed = await tx.queryOne<any>("SELECT * FROM financial_transactions WHERE idempotency_key = ?", [idempotencyKey]);
      if (replayed) return;
    }

    await tx.execute(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, customer_id, stay_id, category,
        description, billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, invoice_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'TIFFIN_PAYMENT', ?, ?, ?,
        ?, NULL, ?, NULL, 'TIFFIN',
        ?, NULL, NULL, ?, 'POSTED',
        NULL, ?, ?, ?, ?
      )
    `, [
      txnId,
      amount,
      transactionDate,
      paymentMethod,
      referenceNumber,
      customerId,
      input.notes?.trim() || `Tiffin payment from ${customer.fullName}`,
      idempotencyKey,
      input.invoiceId?.trim() || null,
      actor.id,
      now,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.payment_recorded",
      targetType: "transaction",
      targetId: txnId,
      metadata: {
        customerId,
        customerName: customer.fullName,
        amount,
        paymentMethod,
        referenceNumber,
        invoiceId: input.invoiceId || null,
      },
      ipAddress: clientIp,
    }, tx);

    // If an invoiceId was provided, allocate payment against the invoice
    if (input.invoiceId?.trim()) {
      const alloc = await allocatePaymentToInvoice(
        actor,
        {
          invoiceId: input.invoiceId.trim(),
          paymentTransactionId: txnId,
          amount,
          notes: input.notes?.trim() || null,
        },
        clientIp,
        tx as any
      );
      allocatedResult = alloc.allocation;
    }
  });

  if (replayed) return replayIdempotent(replayed);

  const row = await db.queryOne<any>(`
    SELECT t.*, c.full_name as customer_name
    FROM financial_transactions t
    LEFT JOIN tiffin_customers c ON c.id = t.customer_id
    WHERE t.id = ?
  `, [txnId]);

  return {
    transaction: {
      id: row.id,
      transactionType: row.transaction_type,
      amount: Number(row.amount),
      transactionDate: row.transaction_date,
      paymentMethod: row.payment_method,
      referenceNumber: row.reference_number,
      residentId: null,
      customerId: row.customer_id,
      customerName: row.customer_name || null,
      stayId: null,
      category: row.category,
      description: row.description,
      billingPeriod: row.billing_period,
      payeeVendor: row.payee_vendor,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      reversalOfId: row.reversal_of_id,
      invoiceId: row.invoice_id || null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    allocation: allocatedResult,
  };
}

/**
 * Calculates current customer ledger balance, unallocated funds, and billing history.
 * Requires finance.read or tiffin.read permission.
 */
export async function getTiffinCustomerBalance(
  actor: AuthenticatedUser,
  customerId: string,
  asyncDb?: AsyncDb
): Promise<TiffinCustomerBalanceSummary> {
  const db = asyncDb ?? getAsyncDb();
  requirePermission(actor, "tiffin.read");

  const customer = await db.queryOne<any>(`
    SELECT id, full_name, phone FROM tiffin_customers WHERE id = ?
  `, [customerId]);

  if (!customer) {
    throw new Error(`Customer '${customerId}' not found.`);
  }

  const totals = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'TIFFIN_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalCharged,
      COALESCE(SUM(CASE WHEN transaction_type = 'TIFFIN_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalPaid
    FROM financial_transactions
    WHERE customer_id = ?
  `, [customerId]);

  const totalCharged = Number(totals?.totalCharged || 0);
  const totalPaid = Number(totals?.totalPaid || 0);
  const outstandingBalance = Math.max(0, totalCharged - totalPaid);

  // Compute unallocated payments
  const unallocRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(t.amount), 0) - COALESCE(SUM(a.amount), 0) as unallocated
    FROM financial_transactions t
    LEFT JOIN invoice_payment_allocations a ON a.payment_transaction_id = t.id
    WHERE t.customer_id = ?
      AND t.transaction_type = 'TIFFIN_PAYMENT'
      AND t.status = 'POSTED'
  `, [customerId]);

  const unallocatedPaymentAmount = Math.max(0, Number(unallocRow?.unallocated || 0));

  // Fetch recent invoices
  const invoiceRows = await db.query<any>(`
    SELECT *
    FROM invoices
    WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `, [customerId]);

  // Fetch recent payments
  const paymentRows = await db.query<any>(`
    SELECT *
    FROM financial_transactions
    WHERE customer_id = ?
      AND transaction_type = 'TIFFIN_PAYMENT'
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT 50
  `, [customerId]);

  return {
    customerId: customer.id,
    customerName: customer.full_name,
    phone: customer.phone,
    totalCharged,
    totalPaid,
    outstandingBalance,
    unallocatedPaymentAmount,
    invoices: invoiceRows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceType: r.invoice_type,
      invoiceCategory: r.invoice_category || "TIFFIN",
      status: r.status,
      residentId: null,
      customerId: r.customer_id,
      customerName: customer.full_name,
      subscriptionId: r.subscription_id,
      stayId: null,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      billingPeriod: r.billing_period,
      subtotal: Number(r.subtotal),
      cgstAmount: Number(r.cgst_amount),
      sgstAmount: Number(r.sgst_amount),
      igstAmount: Number(r.igst_amount),
      totalTax: Number(r.total_tax),
      totalAmount: Number(r.total_amount),
      amountPaid: Number(r.amount_paid),
      balanceDue: Number(r.balance_due),
      companyName: r.company_name,
      companyAddress: r.company_address,
      companyGstin: r.company_gstin,
      companyStateCode: r.company_state_code,
      recipientName: r.recipient_name,
      recipientPhone: r.recipient_phone,
      recipientEmail: r.recipient_email,
      recipientAddress: r.recipient_address,
      recipientGstin: r.recipient_gstin,
      recipientStateCode: r.recipient_state_code,
      rentChargeId: r.rent_charge_id,
      notes: r.notes,
      cancelledAt: r.cancelled_at,
      cancellationReason: r.cancellation_reason,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    payments: paymentRows.map((r) => ({
      id: r.id,
      transactionType: r.transaction_type,
      amount: Number(r.amount),
      transactionDate: r.transaction_date,
      paymentMethod: r.payment_method,
      referenceNumber: r.reference_number,
      residentId: null,
      customerId: r.customer_id,
      customerName: customer.full_name,
      stayId: null,
      category: r.category,
      description: r.description,
      billingPeriod: r.billing_period,
      payeeVendor: r.payee_vendor,
      idempotencyKey: r.idempotency_key,
      status: r.status,
      reversalOfId: r.reversal_of_id,
      invoiceId: r.invoice_id || null,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  };
}

/**
 * Returns all posted TIFFIN_PAYMENT records for a customer that have remaining unallocated balance.
 */
export async function getUnallocatedPaymentsForCustomer(
  actorOrCustomerId: AuthenticatedUser | string,
  customerIdOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<Array<{
  paymentId: string;
  transactionDate: string;
  amount: number;
  paymentMethod: string | null;
  referenceNumber: string | null;
  unallocatedAmount: number;
}>> {
  let customerId: string;
  let dbInstance: AsyncDb | undefined;

  if (typeof actorOrCustomerId === "string") {
    customerId = actorOrCustomerId;
    dbInstance = typeof customerIdOrDb === "object" ? customerIdOrDb : asyncDb;
  } else {
    customerId = typeof customerIdOrDb === "string" ? customerIdOrDb : "";
    dbInstance = asyncDb;
  }

  const db = dbInstance ?? getAsyncDb();

  const rows = await db.query<any>(`
    SELECT
      t.id as paymentId,
      t.transaction_date as transactionDate,
      t.amount,
      t.payment_method as paymentMethod,
      t.reference_number as referenceNumber,
      COALESCE(SUM(a.amount), 0) as allocatedAmount
    FROM financial_transactions t
    LEFT JOIN invoice_payment_allocations a ON a.payment_transaction_id = t.id
    WHERE t.customer_id = ?
      AND t.transaction_type = 'TIFFIN_PAYMENT'
      AND t.status = 'POSTED'
    GROUP BY t.id, t.transaction_date, t.amount, t.payment_method, t.reference_number
    ORDER BY t.transaction_date ASC
  `, [customerId]);

  return rows
    .map((r) => {
      const amount = Number(r.amount);
      const allocated = Number(r.allocatedAmount);
      return {
        paymentId: r.paymentId,
        transactionDate: r.transactionDate,
        amount,
        paymentMethod: r.paymentMethod,
        referenceNumber: r.referenceNumber,
        unallocatedAmount: Math.max(0, amount - allocated),
      };
    })
    .filter((r) => r.unallocatedAmount > 0);
}

// ============================================================================
// PHASE 10: PREPAID TIFFIN BILLING RECONCILIATION (TASK 01B.51)
// ============================================================================

/**
 * Surfaces unfulfilled delivery tasks on fixed prepaid subscriptions (PER_MONTH)
 * and checks their operational reconciliation and billing status.
 * Requires finance.read or tiffin.read permission.
 */
export async function getPrepaidBillingExceptions(
  actor: AuthenticatedUser,
  options?: GetPrepaidBillingExceptionsOptions,
  asyncDb?: AsyncDb
): Promise<PrepaidBillingExceptionsSummary> {
  const db = asyncDb ?? getAsyncDb();

  // Privilege Guard: Super Admin, Accountant, Operations Manager
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ACCOUNTANT" && actor.role !== "OPERATIONS_MANAGER") {
    requirePermission(actor, "finance.read");
  }

  const conditions: string[] = [
    "dt.order_type = 'EXTERNAL'",
    "dt.status = 'EXCEPTION'",
    "tp.billing_unit = 'PER_MONTH'",
  ];
  const params: any[] = [];

  if (options?.customerId) {
    conditions.push("ts.customer_id = ?");
    params.push(options.customerId);
  }
  if (options?.subscriptionId) {
    conditions.push("ts.id = ?");
    params.push(options.subscriptionId);
  }
  if (options?.billingPeriod) {
    conditions.push("dt.service_date LIKE ?");
    params.push(`${options.billingPeriod}%`);
  }
  if (options?.startDate) {
    conditions.push("dt.service_date >= ?");
    params.push(options.startDate);
  }
  if (options?.endDate) {
    conditions.push("dt.service_date <= ?");
    params.push(options.endDate);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const rows = await db.query<any>(`
    SELECT
      dt.id as task_id,
      dt.service_date,
      dt.meal_type,
      dt.order_type,
      dt.exception_type,
      dt.exception_reason,
      dt.exception_at,
      dt.exception_by,
      dt.delivery_notes,
      dt.subscription_id,
      ts.customer_id,
      tc.full_name as customer_name,
      tc.phone as customer_phone,
      tp.name as product_name,
      tp.billing_unit,
      ts.price as agreed_price
    FROM delivery_tasks dt
    INNER JOIN tiffin_subscriptions ts ON dt.subscription_id = ts.id
    INNER JOIN tiffin_products tp ON ts.product_id = tp.id
    INNER JOIN tiffin_customers tc ON ts.customer_id = tc.id
    ${whereClause}
    ORDER BY dt.service_date DESC, dt.meal_type ASC
  `, params);

  const exceptions: PrepaidBillingExceptionItem[] = [];

  for (const r of rows) {
    const period = r.service_date.slice(0, 7);

    // 1. Find covered invoice for this subscription & period
    const invoice = await db.queryOne<any>(`
      SELECT id, invoice_number, status, total_amount, amount_paid, balance_due
      FROM invoices
      WHERE customer_id = ?
        AND subscription_id = ?
        AND billing_period = ?
        AND status != 'CANCELLED'
      LIMIT 1
    `, [r.customer_id, r.subscription_id, period]);

    const isCoveredByPaidInvoice = Boolean(
      invoice && (Number(invoice.amount_paid) > 0 || Number(invoice.balance_due) === 0)
    );

    // 2. Check reconciliation audit log
    const audit = await db.queryOne<any>(`
      SELECT id, actor_id, actor_username, metadata, created_at
      FROM audit_logs
      WHERE target_type = 'delivery_task'
        AND target_id = ?
        AND action = 'tiffin.prepaid_exception_reconciled'
      ORDER BY created_at DESC
      LIMIT 1
    `, [r.task_id]);

    let reconciliationStatus: "PENDING_REVIEW" | "RECONCILED" = "PENDING_REVIEW";
    let reconciliationResolution: PrepaidExceptionResolution | null = null;
    let reconciliationNotes: string | null = null;
    let reconciledAt: string | null = null;
    let reconciledBy: string | null = null;
    let reconciledByName: string | null = null;

    if (audit) {
      reconciliationStatus = "RECONCILED";
      reconciledAt = audit.created_at;
      reconciledBy = audit.actor_id;
      reconciledByName = audit.actor_username;
      try {
        const meta = typeof audit.metadata === "string" ? JSON.parse(audit.metadata) : audit.metadata;
        reconciliationResolution = meta.resolution || null;
        reconciliationNotes = meta.notes || null;
      } catch {
        // fallback
      }
    }

    if (options?.status && options.status !== "ALL" && reconciliationStatus !== options.status) {
      continue;
    }

    exceptions.push({
      taskId: r.task_id,
      serviceDate: r.service_date,
      mealType: r.meal_type as MealType,
      orderType: "EXTERNAL",
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerPhone: r.customer_phone || null,
      subscriptionId: r.subscription_id,
      productName: r.product_name,
      billingUnit: r.billing_unit,
      agreedPrice: Number(r.agreed_price),
      exceptionType: r.exception_type || null,
      exceptionReason: r.exception_reason || null,
      exceptionAt: r.exception_at || null,
      exceptionBy: r.exception_by || null,
      invoiceId: invoice?.id || null,
      invoiceNumber: invoice?.invoice_number || null,
      invoiceStatus: (invoice?.status as InvoiceStatus) || null,
      invoiceTotalAmount: invoice ? Number(invoice.total_amount) : null,
      invoiceAmountPaid: invoice ? Number(invoice.amount_paid) : null,
      isCoveredByPaidInvoice,
      reconciliationStatus,
      reconciliationResolution,
      reconciliationNotes,
      reconciledAt,
      reconciledBy,
      reconciledByName,
      policyNotes: "Under current financial policies, prepaid exceptions are tracked for management review. Automated refund/credit generation is deferred pending management authorization.",
    });
  }

  const pendingReviewCount = exceptions.filter((e) => e.reconciliationStatus === "PENDING_REVIEW").length;
  const reconciledCount = exceptions.filter((e) => e.reconciliationStatus === "RECONCILED").length;
  const coveredByPaidInvoiceCount = exceptions.filter((e) => e.isCoveredByPaidInvoice).length;

  return {
    totalExceptionsCount: exceptions.length,
    pendingReviewCount,
    reconciledCount,
    coveredByPaidInvoiceCount,
    exceptions,
  };
}

/**
 * Reconciles an unfulfilled prepaid service exception with an auditable disposition.
 * Strictly prevents duplicate reconciliation.
 * Preserves historical invoices and financial ledger records without unauthorized modification.
 * Requires finance.manage or tiffin.manage permission.
 */
export async function reconcilePrepaidException(
  actor: AuthenticatedUser,
  input: ReconcilePrepaidExceptionInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<ReconcilePrepaidExceptionResult> {
  const db = asyncDb ?? getAsyncDb();

  // Privilege Guard: Super Admin, Accountant, Operations Manager
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "ACCOUNTANT" && actor.role !== "OPERATIONS_MANAGER") {
    requirePermission(actor, "finance.manage", { ip: clientIp, action: "tiffin.prepaid_exception_reconciled" });
  }

  const taskId = input.taskId?.trim();
  const resolution = input.resolution;
  const notes = input.notes?.trim() || "";

  if (!taskId) {
    throw new Error("Task ID is required.");
  }

  const VALID_RESOLUTIONS: readonly PrepaidExceptionResolution[] = [
    "REVIEWED_NO_ACTION",
    "CREDIT_PENDING_POLICY",
    "RESOLVED_MANUAL_ADJUSTMENT",
  ];
  if (!VALID_RESOLUTIONS.includes(resolution)) {
    throw new Error(`Invalid reconciliation resolution '${resolution}'. Must be REVIEWED_NO_ACTION, CREDIT_PENDING_POLICY, or RESOLVED_MANUAL_ADJUSTMENT.`);
  }

  // 1. Fetch task and subscription context
  const task = await db.queryOne<any>(`
    SELECT
      dt.id as task_id,
      dt.order_type,
      dt.status,
      dt.service_date,
      dt.meal_type,
      dt.subscription_id,
      dt.delivery_notes,
      ts.customer_id,
      tp.billing_unit
    FROM delivery_tasks dt
    LEFT JOIN tiffin_subscriptions ts ON dt.subscription_id = ts.id
    LEFT JOIN tiffin_products tp ON ts.product_id = tp.id
    WHERE dt.id = ?
  `, [taskId]);

  if (!task) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  if (task.order_type === "RESIDENT") {
    throw new Error("Resident delivery tasks are strictly excluded from commercial prepaid exception reconciliation.");
  }

  if (task.status !== "EXCEPTION") {
    throw new Error(`Delivery task '${taskId}' is in status '${task.status}'. Only tasks in EXCEPTION status can be reconciled.`);
  }

  if (!task.subscription_id) {
    throw new Error(`Delivery task '${taskId}' is not linked to any commercial subscription.`);
  }

  if (task.billing_unit !== "PER_MONTH") {
    throw new Error(`Prepaid exception reconciliation applies only to fixed monthly packages ('PER_MONTH'). Task '${taskId}' has billing unit '${task.billing_unit}'.`);
  }

  // 2. Prevent duplicate reconciliation
  const existingAudit = await db.queryOne<any>(`
    SELECT id, actor_id, actor_username, created_at
    FROM audit_logs
    WHERE target_type = 'delivery_task'
      AND target_id = ?
      AND action = 'tiffin.prepaid_exception_reconciled'
    LIMIT 1
  `, [taskId]);

  if (existingAudit) {
    throw new Error(
      `Delivery task exception '${taskId}' has already been reconciled on ${existingAudit.created_at} by ${existingAudit.actor_username || existingAudit.actor_id}. Duplicate reconciliation is rejected.`
    );
  }

  const now = new Date().toISOString();
  const noteEntry = `[RECONCILED ${now.slice(0, 10)} by ${actor.username}]: ${resolution}${notes ? ` - ${notes}` : ""}`;

  await db.transaction(async (tx) => {
    // Append note without changing status or touching invoices
    const existingNotes = task.delivery_notes ? `${task.delivery_notes}\n` : "";
    await tx.execute(`
      UPDATE delivery_tasks
      SET delivery_notes = ?, updated_at = ?
      WHERE id = ?
    `, [existingNotes + noteEntry, now, taskId]);

    // Record immutable audit event
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "tiffin.prepaid_exception_reconciled",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        resolution,
        notes: notes || null,
        customerId: task.customer_id,
        subscriptionId: task.subscription_id,
        serviceDate: task.service_date,
        mealType: task.meal_type,
        reconciledAt: now,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return {
    taskId,
    customerId: task.customer_id,
    subscriptionId: task.subscription_id,
    resolution,
    notes,
    reconciledAt: now,
    reconciledBy: actor.id,
    reconciledByName: actor.username,
    policyStatement: "Under current policy, automated credit notes or ledger adjustments are deferred pending management policy determination. No invoices or ledger transactions were altered.",
  };
}

/** Boxes billed for one delivered subscription delivery: delivered item quantities when recorded. */
function boxesFor(task: { delivered_boxes?: number | string | null }, quantityPerMeal: number): number {
  return task.delivered_boxes === null || task.delivered_boxes === undefined ? quantityPerMeal : Number(task.delivered_boxes);
}
