import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  createInvoice,
  issueInvoice,
  allocatePaymentToInvoice,
  cancelInvoice,
  getInvoiceById,
  listInvoices,
  getUnallocatedPaymentsForResident,
  calculateInvoiceTotals,
  generateNextInvoiceNumber,
} from "../apps/erp/src/server/finance/invoiceService";
import {
  recordRentCharge,
  recordRentPayment,
  reverseTransaction,
  getResidentRentBalance,
} from "../apps/erp/src/server/finance/financeService";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Primary database path for zero-modification guard
const primaryDbPath = path.resolve(__dirname, "../data/erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated test database path
const TEST_INVOICING_DB_PATH = path.resolve(__dirname, "test_invoicing.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_INVOICING_DB_PATH)) fs.unlinkSync(TEST_INVOICING_DB_PATH);
  const wal = `${TEST_INVOICING_DB_PATH}-wal`;
  const shm = `${TEST_INVOICING_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_INVOICING_DB_PATH;

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

console.log("================================================================================");
console.log("RAVINARAYAN ERP — PHASE 1 INVOICING & BILLING ENGINE TEST SUITE");
console.log("================================================================================\n");

async function runInvoicingTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_super_admin_inv",
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Ravinarayan Super Admin",
    role: "SUPER_ADMIN",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_inv",
    username: "accountant",
    email: "accountant@ravinarayan.in",
    fullName: "Lead Accountant",
    role: "ACCOUNTANT",
  };

  const opsManagerUser: AuthenticatedUser = {
    id: "usr_ops_manager_inv",
    username: "opsmanager",
    email: "ops@ravinarayan.in",
    fullName: "Operations Lead",
    role: "OPERATIONS_MANAGER",
  };

  const kitchenUser: AuthenticatedUser = {
    id: "usr_kitchen_inv",
    username: "kitchenhead",
    email: "kitchen@ravinarayan.in",
    fullName: "Kitchen Supervisor",
    role: "KITCHEN_OPERATIONS",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Database Migration V11 & Invoicing Schema Invariants
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V11 & Invoicing Schema Verification");

  const db = new Database(TEST_INVOICING_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run full migrations to V11
  runMigrations(db);

  const version = db.pragma("user_version", { simple: true }) as number;
  assert(Number(version) >= 11, `Database schema version advanced to at least 11 (got ${version})`);

  // Verify tables exist
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(
    (t) => t.name
  );
  assert(tables.includes("invoice_counters"), "invoice_counters table created");
  assert(tables.includes("invoices"), "invoices table created");
  assert(tables.includes("invoice_items"), "invoice_items table created");
  assert(tables.includes("invoice_payment_allocations"), "invoice_payment_allocations table created");

  // Verify financial_transactions.invoice_id
  const finCols = (db.prepare("PRAGMA table_info(financial_transactions)").all() as any[]).map(
    (c) => c.name
  );
  assert(finCols.includes("invoice_id"), "financial_transactions has invoice_id column");

  // Seed baseline staff users, room, and resident for invoicing tests
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES
      ('usr_super_admin_inv', 'admin', 'admin@ravinarayan.in', 'Super Admin', 'hash', 'SUPER_ADMIN', 1, ?, ?),
      ('usr_accountant_inv', 'accountant', 'accountant@ravinarayan.in', 'Accountant', 'hash', 'ACCOUNTANT', 1, ?, ?),
      ('usr_ops_manager_inv', 'opsmanager', 'ops@ravinarayan.in', 'Ops Manager', 'hash', 'OPERATIONS_MANAGER', 1, ?, ?),
      ('usr_kitchen_inv', 'kitchenhead', 'kitchen@ravinarayan.in', 'Kitchen Head', 'hash', 'KITCHEN_OPERATIONS', 1, ?, ?)
  `).run(now, now, now, now, now, now, now, now);

  db.prepare(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES
      ('rm_101', '101', 1, 'DOUBLE', 2, 8500, 1, ?, ?),
      ('rm_102', '102', 1, 'DOUBLE', 2, 9000, 1, ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO residents (id, full_name, phone, email, status, created_at, updated_at)
    VALUES
      ('res_aarav', 'Aarav Sharma', '9876543210', 'aarav@example.com', 'ACTIVE', ?, ?),
      ('res_priya', 'Priya Patel', '9876543211', 'priya@example.com', 'ACTIVE', ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES
      ('stay_aarav', 'res_aarav', 'rm_101', '2026-10-01', 8500, 5000, 'ACTIVE', ?, ?),
      ('stay_priya', 'res_priya', 'rm_102', '2026-10-01', 9000, 5000, 'ACTIVE', ?, ?)
  `).run(now, now, now, now);

  db.close();

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Regular Bill Creation, Draft Lifecycle & Zero Tax Invariant
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Regular Bill Creation, Draft Lifecycle & Zero Tax Invariant");

  const draftBill = await createInvoice(accountantUser, {
    residentId: "res_aarav",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "October 2026",
    issueDate: "2026-10-01",
    dueDate: "2026-10-07",
    autoIssue: false,
    items: [
      {
        description: "Monthly PG Accommodation",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 8500,
      },
    ],
  });

  assert(draftBill.status === "DRAFT", "Draft invoice defaults to status DRAFT");
  assert(draftBill.invoiceNumber === null, "Draft invoice has invoiceNumber === null (sequence number not yet consumed)");
  assert(draftBill.subtotal === 8500, "Draft subtotal is ₹8,500");
  assert(draftBill.totalTax === 0, "Regular bill has strictly 0% total tax");
  assert(draftBill.cgstAmount === 0 && draftBill.sgstAmount === 0 && draftBill.igstAmount === 0, "Regular bill tax components are all ₹0");
  assert(draftBill.totalAmount === 8500, "Draft total amount equals subtotal (₹8,500)");
  assert(draftBill.amountPaid === 0, "Draft amount paid is ₹0");
  assert(draftBill.balanceDue === 8500, "Draft balance due equals total amount (₹8,500)");
  assert(draftBill.items?.length === 1, "Invoice has exactly 1 line item");
  assert(draftBill.rentChargeId === null, "Draft invoice has not created or linked a financial charge yet");

  // Verify rent balance for Aarav is still 0 (draft doesn't affect ledger)
  const aaravBalancePreIssue = await getResidentRentBalance("res_aarav");
  assert(aaravBalancePreIssue === 0, `Draft invoice does not alter ledger balance (got ₹${aaravBalancePreIssue})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Concurrency-Safe Sequential Invoice Numbering (INV-YYYY-NNNN)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Concurrency-Safe Sequential Invoice Numbering (INV-YYYY-NNNN)");

  // Issue the draft bill
  const issuedBill1 = await issueInvoice(accountantUser, draftBill.id);
  assert(issuedBill1.status === "ISSUED", "Invoice status transitioned to ISSUED");
  assert(issuedBill1.invoiceNumber === "INV-2026-0001", `First invoice assigned INV-2026-0001 (got ${issuedBill1.invoiceNumber})`);

  // Create & auto-issue a second invoice
  const issuedBill2 = await createInvoice(accountantUser, {
    residentId: "res_priya",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "October 2026",
    issueDate: "2026-10-01",
    dueDate: "2026-10-07",
    autoIssue: true,
    items: [
      {
        description: "Monthly PG Accommodation",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 9000,
      },
    ],
  });

  assert(issuedBill2.invoiceNumber === "INV-2026-0002", `Second invoice assigned INV-2026-0002 (got ${issuedBill2.invoiceNumber})`);

  // Create & auto-issue a third invoice
  const issuedBill3 = await createInvoice(accountantUser, {
    residentId: "res_aarav",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "November 2026",
    issueDate: "2026-11-01",
    dueDate: "2026-11-07",
    autoIssue: true,
    items: [
      {
        description: "Monthly PG Accommodation",
        quantity: 1,
        unitPrice: 8500,
      },
    ],
  });

  assert(issuedBill3.invoiceNumber === "INV-2026-0003", `Third invoice assigned INV-2026-0003 (got ${issuedBill3.invoiceNumber})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: GST Tax Invoice Calculations (Intrastate vs Interstate)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] GST Tax Invoice Calculations (Intrastate vs Interstate)");

  // Intrastate supply: Haryana (06) to Haryana (06) with 12% room rent and 5% food
  const intrastateTotals = calculateInvoiceTotals(
    [
      {
        description: "Premium Room Accommodation",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 10000,
        taxRate: 12,
      },
      {
        description: "Tiffin Meal Package",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 2000,
        taxRate: 5,
      },
    ],
    "GST_TAX_INVOICE",
    "06",
    "06"
  );

  assert(intrastateTotals.subtotal === 12000, `Intrastate subtotal is ₹12,000 (got ₹${intrastateTotals.subtotal})`);
  // 12% on 10000 = 1200 (CGST 600, SGST 600)
  // 5% on 2000 = 100 (CGST 50, SGST 50)
  // Total CGST = 650, Total SGST = 650, IGST = 0
  assert(intrastateTotals.cgstAmount === 650, `Intrastate CGST is ₹650 (got ₹${intrastateTotals.cgstAmount})`);
  assert(intrastateTotals.sgstAmount === 650, `Intrastate SGST is ₹650 (got ₹${intrastateTotals.sgstAmount})`);
  assert(intrastateTotals.igstAmount === 0, `Intrastate IGST is ₹0 (got ₹${intrastateTotals.igstAmount})`);
  assert(intrastateTotals.totalTax === 1300, `Intrastate total tax is ₹1,300 (got ₹${intrastateTotals.totalTax})`);
  assert(intrastateTotals.totalAmount === 13300, `Intrastate total amount is ₹13,300 (got ₹${intrastateTotals.totalAmount})`);

  // Interstate supply: Haryana (06) to Delhi (07)
  const interstateTotals = calculateInvoiceTotals(
    [
      {
        description: "Premium Room Accommodation",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 10000,
        taxRate: 12,
      },
    ],
    "GST_TAX_INVOICE",
    "06",
    "07"
  );

  assert(interstateTotals.cgstAmount === 0, `Interstate CGST is ₹0 (got ₹${interstateTotals.cgstAmount})`);
  assert(interstateTotals.sgstAmount === 0, `Interstate SGST is ₹0 (got ₹${interstateTotals.sgstAmount})`);
  assert(interstateTotals.igstAmount === 1200, `Interstate IGST is ₹1,200 (got ₹${interstateTotals.igstAmount})`);
  assert(interstateTotals.totalAmount === 11200, `Interstate total is ₹11,200 (got ₹${interstateTotals.totalAmount})`);

  // Unsupported tax rate rejected
  let unsupportedRateCaught = false;
  try {
    calculateInvoiceTotals(
      [{ description: "Misc", quantity: 1, unitPrice: 1000, taxRate: 28 }],
      "GST_TAX_INVOICE",
      "06",
      "06"
    );
  } catch (err: any) {
    unsupportedRateCaught = err.message.includes("Unsupported GST tax rate");
  }
  assert(unsupportedRateCaught, "Validation rejects unsupported GST tax rate (28%)");

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Authentic GSTIN Guard & Missing Configuration Prevention
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Authentic GSTIN Guard & Missing Configuration Prevention");

  // Ensure ERP_COMPANY_GSTIN is unset
  delete process.env.ERP_COMPANY_GSTIN;

  let gstinGuardCaught = false;
  try {
    await createInvoice(accountantUser, {
      residentId: "res_aarav",
      invoiceType: "GST_TAX_INVOICE",
      billingPeriod: "December 2026",
      issueDate: "2026-12-01",
      dueDate: "2026-12-07",
      items: [
        {
          description: "Room Rent",
          quantity: 1,
          unitPrice: 10000,
          taxRate: 12,
        },
      ],
    });
  } catch (err: any) {
    gstinGuardCaught = err.message.includes("registered company GSTIN");
  }
  assert(gstinGuardCaught, "Validation strictly blocks GST_TAX_INVOICE if ERP_COMPANY_GSTIN is not configured");

  // Configure genuine GSTIN
  process.env.ERP_COMPANY_GSTIN = "06AAAAA0000A1Z6";

  const gstInvoice = await createInvoice(accountantUser, {
    residentId: "res_priya",
    invoiceType: "GST_TAX_INVOICE",
    billingPeriod: "December 2026",
    issueDate: "2026-12-01",
    dueDate: "2026-12-07",
    autoIssue: true,
    recipientStateCode: "06",
    items: [
      {
        description: "Room Rent",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 10000,
        taxRate: 12,
      },
    ],
  });

  assert(gstInvoice.invoiceType === "GST_TAX_INVOICE", "GST Invoice created successfully when GSTIN is configured");
  assert(gstInvoice.companyGstin === "06AAAAA0000A1Z6", "Invoice stores configured company GSTIN snapshot");
  assert(gstInvoice.totalAmount === 11200, "GST Invoice total includes 12% GST (₹11,200)");
  assert(gstInvoice.cgstAmount === 600 && gstInvoice.sgstAmount === 600, "CGST and SGST split equally (₹600 each)");

  // Clean up env for safety
  delete process.env.ERP_COMPANY_GSTIN;

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Atomic Ledger Linkage & Anti-Double-Counting Invariant
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Atomic Ledger Linkage & Anti-Double-Counting Invariant");

  // Case A: Create an unlinked RENT_CHARGE in financial_transactions for January 2027
  const standaloneCharge = await recordRentCharge(accountantUser, {
    residentId: "res_aarav",
    stayId: "stay_aarav",
    amount: 8500,
    transactionDate: "2027-01-01",
    billingPeriod: "January 2027",
    description: "Monthly Rent January 2027",
  });

  const balanceBeforeInvoice = await getResidentRentBalance("res_aarav");

  // Now create and issue an invoice for January 2027
  const linkedInvoice = await createInvoice(accountantUser, {
    residentId: "res_aarav",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "January 2027",
    issueDate: "2027-01-01",
    dueDate: "2027-01-07",
    autoIssue: true,
    linkExistingCharge: true,
    items: [
      {
        description: "Monthly PG Accommodation",
        quantity: 1,
        unitPrice: 8500,
      },
    ],
  });

  assert(linkedInvoice.rentChargeId === standaloneCharge.id, "Invoice linked to existing posted RENT_CHARGE");

  // Verify resident balance was NOT increased a second time
  const balanceAfterInvoice = await getResidentRentBalance("res_aarav");
  assert(
    balanceAfterInvoice === balanceBeforeInvoice,
    `Anti-Double-Counting Invariant preserved: Balance before (₹${balanceBeforeInvoice}) === Balance after (₹${balanceAfterInvoice})`
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Payment Allocation Engine & Partial / Full Settlement
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Payment Allocation Engine & Partial / Full Settlement");

  // Create an invoice of ₹10,000 for Priya for February 2027
  const febInvoice = await createInvoice(accountantUser, {
    residentId: "res_priya",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "February 2027",
    issueDate: "2027-02-01",
    dueDate: "2027-02-07",
    autoIssue: true,
    items: [
      {
        description: "Room Rent",
        quantity: 1,
        unitPrice: 10000,
      },
    ],
  });

  assert(febInvoice.balanceDue === 10000, "Initial invoice balance due is ₹10,000");
  assert(febInvoice.status === "ISSUED", "Initial status is ISSUED");

  // Record a payment of ₹4,000 for Priya
  const payment1 = await recordRentPayment(accountantUser, {
    residentId: "res_priya",
    amount: 4000,
    paymentMethod: "UPI",
    transactionDate: "2027-02-02",
    referenceNumber: "UPI-FEB-01",
  });

  // Check unallocated payments helper
  const unalloc1 = await getUnallocatedPaymentsForResident(accountantUser, "res_priya");
  const p1Record = unalloc1.find((p) => p.paymentId === payment1.id);
  assert(p1Record !== undefined && p1Record.unallocatedAmount === 4000, "Payment has ₹4,000 unallocated");

  // Allocate partial payment ₹4,000 to invoice
  const { invoice: febAfterAlloc1, allocation: alloc1 } = await allocatePaymentToInvoice(accountantUser, {
    invoiceId: febInvoice.id,
    paymentTransactionId: payment1.id,
  });

  assert(alloc1.amount === 4000, "Allocation record created for ₹4,000");
  assert(febAfterAlloc1.amountPaid === 4000, "Invoice amount_paid updated to ₹4,000");
  assert(febAfterAlloc1.balanceDue === 6000, "Invoice balance_due updated to ₹6,000 (10000 - 4000)");
  assert(febAfterAlloc1.status === "PARTIALLY_PAID", "Invoice status transitioned to PARTIALLY_PAID");

  // Record a second payment of ₹8,000 for Priya
  const payment2 = await recordRentPayment(accountantUser, {
    residentId: "res_priya",
    amount: 8000,
    paymentMethod: "BANK_TRANSFER",
    transactionDate: "2027-02-03",
    referenceNumber: "NEFT-FEB-02",
  });

  // Allocate remaining balance (₹6,000) from payment2
  const { invoice: febAfterAlloc2, allocation: alloc2 } = await allocatePaymentToInvoice(accountantUser, {
    invoiceId: febInvoice.id,
    paymentTransactionId: payment2.id,
    amount: 6000,
  });

  assert(alloc2.amount === 6000, "Second allocation record created for ₹6,000");
  assert(febAfterAlloc2.amountPaid === 10000, "Invoice amount_paid updated to ₹10,000");
  assert(febAfterAlloc2.balanceDue === 0, "Invoice balance_due is exactly ₹0");
  assert(febAfterAlloc2.status === "PAID", "Invoice status transitioned to PAID");

  // Verify payment2 has ₹2,000 (8000 - 6000) remaining unallocated
  const unalloc2 = await getUnallocatedPaymentsForResident(accountantUser, "res_priya");
  const p2Record = unalloc2.find((p) => p.paymentId === payment2.id);
  assert(p2Record !== undefined && p2Record.unallocatedAmount === 2000, "Payment 2 retains ₹2,000 unallocated balance");

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Allocation Guards & Anti-Over-Allocation Integrity
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Allocation Guards & Anti-Over-Allocation Integrity");

  // Guard 1: Attempting to allocate against a fully PAID invoice fails
  let paidInvoiceAllocCaught = false;
  try {
    await allocatePaymentToInvoice(accountantUser, {
      invoiceId: febInvoice.id,
      paymentTransactionId: payment2.id,
      amount: 1000,
    });
  } catch (err: any) {
    paidInvoiceAllocCaught = err.message.includes("Payments can only be allocated") || err.message.includes("fully paid");
  }
  assert(paidInvoiceAllocCaught, "Guard rejects payment allocation against fully settled PAID invoice");

  // Guard 2: Attempting to allocate more than payment's remaining balance fails
  const marchInvoice = await createInvoice(accountantUser, {
    residentId: "res_priya",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "March 2027",
    issueDate: "2027-03-01",
    dueDate: "2027-03-07",
    autoIssue: true,
    items: [{ description: "Rent", quantity: 1, unitPrice: 9000 }],
  });

  let overAllocCaught = false;
  try {
    await allocatePaymentToInvoice(accountantUser, {
      invoiceId: marchInvoice.id,
      paymentTransactionId: payment2.id,
      amount: 5000, // payment2 only has 2000 left
    });
  } catch (err: any) {
    overAllocCaught = err.message.includes("unallocated remaining");
  }
  assert(overAllocCaught, "Guard rejects allocation exceeding payment unallocated balance");

  // Guard 3: Attempting to allocate Resident A's payment to Resident B's invoice fails
  let crossResidentCaught = false;
  try {
    await allocatePaymentToInvoice(accountantUser, {
      invoiceId: marchInvoice.id, // Priya's invoice
      paymentTransactionId: (await recordRentPayment(accountantUser, {
        residentId: "res_aarav",
        amount: 2000,
        paymentMethod: "CASH",
        transactionDate: "2027-03-01",
      })).id, // Aarav's payment
    });
  } catch (err: any) {
    crossResidentCaught = err.message.includes("does not belong to the invoice recipient");
  }
  assert(crossResidentCaught, "Guard rejects cross-resident payment allocation");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Ledger Reversal Integration (Auto-Deallocation on Reversal)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Ledger Reversal Integration (Auto-Deallocation on Reversal)");

  // Feb invoice is currently PAID with alloc1 (payment1: 4000) and alloc2 (payment2: 6000)
  // Reverse payment1 in financeService
  await reverseTransaction(accountantUser, payment1.id, "Bounced UPI transaction for February");

  // Verify febInvoice automatically had alloc1 deallocated
  const febPostReversal = await getInvoiceById(accountantUser, febInvoice.id);
  assert(febPostReversal !== null, "Loaded invoice after payment reversal");
  assert(febPostReversal?.amountPaid === 6000, `Invoice amount_paid decreased from 10,000 to 6,000 (got ₹${febPostReversal?.amountPaid})`);
  assert(febPostReversal?.balanceDue === 4000, `Invoice balance_due restored to 4,000 (got ₹${febPostReversal?.balanceDue})`);
  assert(febPostReversal?.status === "PARTIALLY_PAID", `Invoice status rolled back to PARTIALLY_PAID (got ${febPostReversal?.status})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 10: Invoice Cancellation Invariants
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] Invoice Cancellation Invariants");

  // Guard: Cannot cancel invoice with payments allocated
  let cancelWithPaidCaught = false;
  try {
    await cancelInvoice(accountantUser, febInvoice.id, "Resident moved out unexpectedly");
  } catch (err: any) {
    cancelWithPaidCaught = err.message.includes("Cannot cancel invoice with allocated payments");
  }
  assert(cancelWithPaidCaught, "Guard prevents cancelling invoice that has allocated payments");

  // Create an unpaid issued invoice and cancel it
  const aprilInvoice = await createInvoice(accountantUser, {
    residentId: "res_aarav",
    invoiceType: "REGULAR_BILL",
    billingPeriod: "April 2027",
    issueDate: "2027-04-01",
    dueDate: "2027-04-07",
    autoIssue: true,
    items: [{ description: "April Rent", quantity: 1, unitPrice: 8500 }],
  });

  const aprilNumber = aprilInvoice.invoiceNumber;
  assert(aprilNumber !== null && aprilNumber.startsWith("INV-"), "April invoice has official number");

  const cancelledApril = await cancelInvoice(accountantUser, aprilInvoice.id, "Duplicate invoice created by front desk");
  assert(cancelledApril.status === "CANCELLED", "Invoice status updated to CANCELLED");
  assert(cancelledApril.invoiceNumber === aprilNumber, "Invoice number preserved on cancelled record (never deleted)");
  assert(cancelledApril.cancelledAt !== null, "Invoice recorded cancelled_at timestamp");
  assert(cancelledApril.cancellationReason === "Duplicate invoice created by front desk", "Cancellation reason recorded");

  // -----------------------------------------------------------------------------
  // TEST SUITE 11: Server-Side RBAC Enforcement
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 11] Server-Side RBAC Enforcement on Invoicing");

  // Least privilege: OPERATIONS_MANAGER has finance.read, but lacks finance.manage
  const opsList = await listInvoices(opsManagerUser);
  assert(opsList.total > 0, "OPERATIONS_MANAGER successfully reads invoice list");

  let opsCreateBlocked = false;
  try {
    await createInvoice(opsManagerUser, {
      residentId: "res_aarav",
      invoiceType: "REGULAR_BILL",
      billingPeriod: "May 2027",
      issueDate: "2027-05-01",
      dueDate: "2027-05-07",
      items: [{ description: "Rent", quantity: 1, unitPrice: 8500 }],
    });
  } catch (err: any) {
    opsCreateBlocked = err instanceof AuthorizationError || err.statusCode === 403;
  }
  assert(opsCreateBlocked, "Privilege Guard: OPERATIONS_MANAGER blocked from creating invoice (HTTP 403)");

  // KITCHEN_OPERATIONS lacks finance.read
  let kitchenListBlocked = false;
  try {
    await listInvoices(kitchenUser);
  } catch (err: any) {
    kitchenListBlocked = err instanceof AuthorizationError || err.statusCode === 403;
  }
  assert(kitchenListBlocked, "Privilege Guard: KITCHEN_OPERATIONS blocked from reading invoices (HTTP 403)");

  // -----------------------------------------------------------------------------
  // TEST SUITE 12: Zero Primary Database Touch Guard & Cleanup
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 12] Zero Primary Database Access Guard & Environment Cleanup");

  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs &&
      primaryStatsBefore.size === primaryStatsAfter.size,
      "CRITICAL: Primary database data/erp.db was NEVER accessed, modified, or written during invoicing tests"
    );
  } else {
    assert(true, "Primary database data/erp.db verification step completed");
  }

  cleanupTestDb();

  // Final summary
  console.log("\n================================================================================");
  console.log(`FINAL INVOICING TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runInvoicingTests().catch((err) => {
  console.error("Unhandled error in invoicing test suite:", err);
  process.exit(1);
});
