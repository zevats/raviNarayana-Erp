/**
 * The application on a database that does NOT have migrations 0020/0021 yet (as localhost's own
 * database, or production between deploy and migration): every existing flow keeps working and the
 * new features switch off instead of failing. Runs on a database this suite creates at 0019 and drops
 * (disposable verification server, RN_PG_VERIFY_URL; names contain "verify" and "test").
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { useVerifyDatabase, createAsserter, insertStaff } from "./helpers/pgVerifyTarget";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require(path.resolve(__dirname, "../../../node_modules/postgres"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrate = require(path.resolve(__dirname, "../../../scripts/migrate.js"));

const baseUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const MIGRATIONS = path.resolve(__dirname, "../../../apps/erp/src/server/database/drizzle");
const tag = crypto.randomBytes(3).toString("hex");
const dbName = `rn_erp_verify_compat_${tag}_test`;
const IP = "127.0.0.1";
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;

function urlFor(db: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

function folderUpTo(lastIdx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: any) => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

async function main() {
  console.log("================================================================================");
  console.log("SCHEMA COMPATIBILITY: application on a database at migration 0019");
  console.log("================================================================================");
  const admin = postgres(baseUrl, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const log = console.log;
  console.log = () => {};
  const applied = await migrate.runMigrations(urlFor(dbName), folderUpTo(19));
  console.log = log;
  assert(applied.length === 20, `Database prepared at 0019 (${applied.length} migrations; 0020 and 0021 not applied)`);
  // Point the application at the 0019 database before its first query.
  process.env.DATABASE_URL = urlFor(dbName);
  process.env.DIRECT_URL = urlFor(dbName);

  const { getAsyncDb } = await import("../apps/erp/src/server/database/db");
  const { closePg } = await import("../apps/erp/src/server/database/client");
  const { createTiffinCustomer, createTiffinProduct } = await import("../apps/erp/src/server/tiffin/tiffinService");
  const { createUnifiedOrder } = await import("../apps/erp/src/server/orders/orderService");
  const { completeDeliveryTask, getDeliveryTaskById, syncDeliveryActions } = await import("../apps/erp/src/server/delivery/deliveryService");
  const { createInvoice } = await import("../apps/erp/src/server/finance/invoiceService");
  const { listReceivables, getReceivableAccount, getAccountStatement, receiveAccountPayment } = await import("../apps/erp/src/server/finance/receivablesService");
  const { setPayLater } = await import("../apps/erp/src/server/tiffin/payLaterService");
  const { getNotifications } = await import("../apps/erp/src/server/notifications/notificationService");
  const { getCashbookSummary } = await import("../apps/erp/src/server/finance/financeService");
  try {
    const db = getAsyncDb();
    const cols = await db.queryOne<any>("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name IN ('orders', 'invoices', 'tiffin_customers') AND column_name IN ('payment_choice', 'billing_month', 'pay_later_enabled')");
    assert(Number(cols?.n) === 0, "The new columns are absent");
    const owner = await insertStaff(db, "SUPER_ADMIN", "Compat Owner");
    const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Compat Manager");
    const driver = await insertStaff(db, "DELIVERY_PERSON", "Compat Driver");
    const product: any = await createTiffinProduct(owner, { code: `CMP_${tag}`.toUpperCase(), name: "Compat Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);
    const cust: any = await createTiffinCustomer(manager, { fullName: `Compat Customer ${tag}`, phone: phone(), deliveryAddress: "Compat Lane" } as any, IP, db);
    const day = "2041-03-03";
    const mk = async (key: string) => {
      const o: any = await createUnifiedOrder(manager, {
        orderType: "DELIVERY", customerId: cust.id, customerName: cust.fullName, customerPhone: cust.phone, deliveryAddress: "Compat Lane", serviceDate: day, mealType: "LUNCH",
        items: [{ productId: product.id, productName: "Compat Thali", quantity: 3, unitPrice: 100 }], idempotencyKey: key,
      } as any, IP, db);
      await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [driver.id, driver.fullName, o.deliveryTaskId]);
      const item = await db.queryOne<any>("SELECT id FROM order_items WHERE order_id = ?", [o.orderId]);
      return { ...o, lines: [{ orderItemId: item.id, deliveredQuantity: 3, undeliveredQuantity: 0 }] };
    };
    const o1 = await mk(`cmp1_${tag}`);
    const task = (await getDeliveryTaskById(driver, o1.deliveryTaskId, db))!.task as any;
    assert(task.payLaterAllowed === undefined, "Delivery stops load; no Pay Later flag is offered (the driver form keeps Cash / UPI)");
    await completeDeliveryTask(driver, o1.deliveryTaskId, { recipientName: "Customer", lines: o1.lines, collectedAmount: 100, paymentMethod: "CASH", paymentChoice: "CASH", idempotencyKey: `cmpd_${tag}` } as any, IP, db);
    const after = (await getDeliveryTaskById(owner, o1.deliveryTaskId, db))!.task as any;
    assert(after.status === "DELIVERED" && after.balanceDue === 200, "A delivery from the new form (with a payment choice) completes as before; the choice is simply not stored");
    const o2 = await mk(`cmp2_${tag}`);
    const synced = await syncDeliveryActions(driver, [{ id: `a_${tag}`, action: "COMPLETE_DELIVERY", taskId: o2.deliveryTaskId, userId: driver.id, idempotencyKey: `off_${tag}`, createdAt: new Date().toISOString(), retryCount: 0, status: "PENDING", payload: { recipientName: "Customer", lines: o2.lines, paymentChoice: "PAY_LATER", payLaterAllowedAtSelection: true } } as any], IP, db);
    assert(synced.results[0].status === "SYNCED", "An offline completion carrying a payment choice syncs as before");
    const inv: any = await createInvoice(owner, { invoiceCategory: "TIFFIN", customerId: cust.id, invoiceType: "REGULAR_BILL", issueDate: day, dueDate: day, billingPeriod: "2041-03", items: [{ description: "Tiffin", unitPrice: 500, quantity: 1 }], autoIssue: true, idempotencyKey: `inv_${tag}` } as any, IP, db);
    assert(Boolean(inv.id) && inv.status === "ISSUED", "Invoices are created as before (the idempotency key is ignored until 0020)");
    const list = await listReceivables(owner, { limit: 25 }, db);
    const acc = await getReceivableAccount(owner, `C:${cust.id}`, db);
    assert(list.summary.total >= 1000 && acc.totals.DELIVERY === 500 && acc.totals.TIFFIN === 500, `Receivables works from the existing records (delivery ₹${acc.totals.DELIVERY}, tiffin ₹${acc.totals.TIFFIN})`);
    const st = await getAccountStatement(owner, `C:${cust.id}`, {}, db);
    assert(st.closing === acc.totals.total, "Statements work and close at the account balance");
    const paid = await receiveAccountPayment(manager, { accountKey: `C:${cust.id}`, paymentMethod: "CASH", transactionDate: day, amountReceived: 200, idempotencyKey: `rcv_${tag}`, items: [{ source: "DELIVERY", refId: o1.orderId, amount: 200 }] }, IP, db);
    assert(paid.account.totals.DELIVERY === 300, "Receive payment works for a delivered order");
    let unavailable: any = null;
    try {
      await setPayLater(owner, cust.id, true, IP, db);
    } catch (e) {
      unavailable = e;
    }
    assert(unavailable?.statusCode === 409, "Pay Later approval answers 'needs migration 0021' (409) instead of failing");
    const feed = await getNotifications(owner, { limit: 50 } as any);
    assert(Array.isArray(feed.notifications), "Notifications load (the review alert is skipped)");
    const cb = await getCashbookSummary(owner, { startDate: "2041-03-01", endDate: "2041-03-31", division: "COMBINED" }, db);
    assert(typeof cb.netCashMovementExact === "number" && Boolean(cb.breakdown), "Cashbook breakdown works (no schema dependency)");
  } finally {
    try {
      await closePg();
    } catch {}
  }

  console.log("\n================================================================================");
  console.log(`SCHEMA COMPATIBILITY RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    state.failed++;
    console.error("Test runner error:", err?.stack ?? err?.message ?? err);
  })
  .finally(async () => {
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } catch (e: any) {
      console.error("cleanup:", e.message);
    } finally {
      await admin.end();
    }
    process.exit(state.failed > 0 ? 1 : 0);
  });
