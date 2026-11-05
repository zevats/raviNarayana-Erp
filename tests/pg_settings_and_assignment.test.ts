/**
 * Live PostgreSQL verification of Settings (Phase 5) and delivery assignment (Phase 2):
 *   Owner-only settings with validation, audit and persistence; meal cutoffs read from Settings;
 *   the default delivery partner for new orders (and an explicit, switched-off partner leaving
 *   orders unassigned instead of silently going to someone else); one-off self-assignment by the
 *   Owner or Manager without changing the default or granting delivery-staff access.
 * Every setting changed here is removed again at the end (the verify database is shared).
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import {
  assignDeliveryTask,
  batchAssignDeliveryTasks,
  getDeliveryTaskById,
  completeDeliveryTask,
  listDeliveryTasks,
  resolveDefaultDeliveryStaff,
} from "../apps/erp/src/server/delivery/deliveryService";
import { getManifestStatus } from "../apps/erp/src/server/delivery/deliveryOps";
import { createTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
import { getSettings, updateSettingsSection, clearSettingsCache, getSettingsForAdmin } from "../apps/erp/src/server/settings/settingsService";
import { getRolePermissions } from "../apps/erp/src/server/authorization/permissions";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;
const at = (date: string, hhmm: string) => ({ now: new Date(`${date}T${hhmm}:00+05:30`) });

async function rejects(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  let err: any = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert(err !== null && pattern.test(String(err.message)), `${label}${err ? ` (${err.message})` : " — NOT rejected"}`);
}

async function main() {
  console.log("================================================================================");
  console.log("PG SETTINGS AND DELIVERY ASSIGNMENT (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const SET_KEYS = ["business.name", "business.phone", "business.email", "business.address", "business.websiteUrl", "meals.lunchPrepareAt", "meals.lunchCutoffAt", "meals.dinnerPrepareAt", "meals.dinnerCutoffAt", "delivery.defaultDriverId"];
  await db.execute(`DELETE FROM business_settings WHERE key IN (${SET_KEYS.map(() => "?").join(", ")})`, SET_KEYS);
  clearSettingsCache();

  const owner = await insertStaff(db, "SUPER_ADMIN", "Settings Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Settings Manager");
  const manager2 = await insertStaff(db, "OPERATIONS_MANAGER", "Other Manager");
  const D1 = await insertStaff(db, "DELIVERY_PERSON", "Default Dinesh");
  const D2 = await insertStaff(db, "DELIVERY_PERSON", "Env Esha");
  process.env.ERP_DEFAULT_DELIVERY_USERNAME = D2.username;
  const day = uniqueBusinessDate(500);
  const thali = await createTiffinProduct(owner, { code: `SA_${rnd()}`.toUpperCase(), name: "Assign Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 80 } as any, undefined, db);
  const newOrder = async (actor: AuthenticatedUser = manager) => {
    const order = await createUnifiedOrder(actor, {
      orderType: "DELIVERY", customerName: `Assign ${rnd()}`, customerPhone: phone(), deliveryAddress: "Assign Road 5",
      serviceDate: day, mealType: "LUNCH", items: [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 1 }], idempotencyKey: `sa_${rnd()}`,
    } as any, IP, db);
    return (await getDeliveryTaskById(owner, order.deliveryTaskId!, db))!;
  };

  try {
    console.log("\n--- 1. Settings: Owner only, validated, audited, persisted ---");
    await rejects("Manager cannot read Settings", () => getSettingsForAdmin(manager, db), /permission|denied|forbidden/i);
    await rejects("Manager cannot change Settings", () => updateSettingsSection(manager, "business", { name: "X" }, IP, db), /permission|denied|forbidden/i);
    await rejects("Invalid email refused", () => updateSettingsSection(owner, "business", { name: "Ravinarayan", email: "not-an-email" }, IP, db), /valid email/i);
    await rejects("Website must be a full https address", () => updateSettingsSection(owner, "business", { name: "Ravinarayan", websiteUrl: "ravinarayan" }, IP, db), /full address|https/i);
    const saved = await updateSettingsSection(owner, "business", { name: "Ravinarayan Test House", phone: "+91 98100 00000", email: "desk@example.com", address: "12 Test Lane", websiteUrl: "https://example.com" }, IP, db);
    assert(saved.business.name === "Ravinarayan Test House" && saved.business.websiteUrl === "https://example.com", "Owner saves business details");
    const audit = await db.queryOne<any>("SELECT metadata FROM audit_logs WHERE action = 'settings.updated' AND actor_id = ? ORDER BY created_at DESC LIMIT 1", [owner.id]);
    const meta = typeof audit?.metadata === "string" ? JSON.parse(audit.metadata) : audit?.metadata;
    assert(meta?.changes?.email?.to === "desk@example.com" && "from" in (meta?.changes?.email || {}), "Change is in the audit log with old and new values");
    clearSettingsCache();
    assert((await getSettings(db)).business.phone === "+91 98100 00000", "Saved values come back from the database after the cache is cleared (server restart / other instance)");
    const again = await updateSettingsSection(owner, "business", { name: "Ravinarayan Test House", phone: "+91 98100 00000", email: "desk@example.com", address: "12 Test Lane", websiteUrl: "https://example.com" }, IP, db);
    const auditCount = await db.queryOne<any>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'settings.updated' AND actor_id = ?", [owner.id]);
    assert(again.business.name === "Ravinarayan Test House" && Number(auditCount.n) === 1, "Saving unchanged values writes no new audit entry");

    console.log("\n--- 2. Meal times drive the cutoff ---");
    await rejects("Cutoff after the list time is refused", () => updateSettingsSection(owner, "meals", { lunchPrepareAt: "08:00", lunchCutoffAt: "09:00", dinnerPrepareAt: "15:30", dinnerCutoffAt: "15:00" }, IP, db), /cutoff/i);
    await rejects("Bad time format is refused", () => updateSettingsSection(owner, "meals", { lunchPrepareAt: "8am", lunchCutoffAt: "07:30", dinnerPrepareAt: "15:30", dinnerCutoffAt: "15:00" }, IP, db), /HH:MM/);
    let st = await getManifestStatus(manager, day, "LUNCH", db, at(day, "07:45"));
    assert(st.cutoffAt === "07:30" && st.pastCutoff === true, "Default lunch cutoff 07:30: 07:45 is past it");
    await updateSettingsSection(owner, "meals", { lunchPrepareAt: "09:00", lunchCutoffAt: "08:30", dinnerPrepareAt: "16:00", dinnerCutoffAt: "15:30" }, IP, db);
    st = await getManifestStatus(manager, day, "LUNCH", db, at(day, "07:45"));
    assert(st.cutoffAt === "08:30" && st.prepareAt === "09:00" && st.pastCutoff === false, "Saved cutoff 08:30: 07:45 is now before it");

    console.log("\n--- 3. Default delivery partner ---");
    let t = await newOrder();
    assert(t.task.assignedTo === D2.id, "No Settings choice: the configured environment partner gets the order (existing behaviour)");
    await rejects("A non-delivery account cannot be the default partner", () => updateSettingsSection(owner, "delivery", { defaultDriverId: manager.id }, IP, db), /delivery staff/i);
    await updateSettingsSection(owner, "delivery", { defaultDriverId: D1.id }, IP, db);
    t = await newOrder();
    assert(t.task.assignedTo === D1.id && t.task.status === "OUT_FOR_DELIVERY", "Settings choice wins: the new order goes to Dinesh automatically and is out for delivery");
    await db.execute("UPDATE staff_users SET is_active = 0 WHERE id = ?", [D1.id]);
    const res = await resolveDefaultDeliveryStaff(db);
    assert(res.staff === null && res.source === "UNAVAILABLE" && res.configured?.id === D1.id, "Switched-off default partner is reported, not replaced");
    t = await newOrder();
    assert(t.task.assignedTo === null && t.task.status === "PENDING", "New order waits unassigned instead of going silently to someone else");
    await db.execute("UPDATE staff_users SET is_active = 1 WHERE id = ?", [D1.id]);

    console.log("\n--- 4. One-off self-assignment ---");
    const s1 = await newOrder();
    await assignDeliveryTask(manager, s1.task.id, { assignedToStaffId: manager.id, reason: "Driver busy, I am going that way" }, IP, db);
    const s1d = (await getDeliveryTaskById(owner, s1.task.id, db))!;
    assert(s1d.task.assignedTo === manager.id && s1d.task.status === "ASSIGNED", "Manager takes the delivery themselves");
    const ev = s1d.events.find((e) => e.eventType === "REASSIGNED");
    assert(Boolean(ev && /from Default Dinesh to Settings Manager \(handling it personally\)\. Reason: Driver busy/.test(ev.notes || "")), "History keeps the original assignee, who changed it and why");
    const aud = await db.queryOne<any>("SELECT metadata FROM audit_logs WHERE action = 'delivery.task_reassigned' AND target_id = ? ORDER BY created_at DESC LIMIT 1", [s1.task.id]);
    const am = typeof aud?.metadata === "string" ? JSON.parse(aud.metadata) : aud?.metadata;
    assert(am?.selfFulfilment === true && am?.previousAssignedTo === D1.id, "Audit row marks the self-assignment and the previous assignee");
    await rejects("A Manager cannot assign a delivery to another Manager", () => assignDeliveryTask(manager, s1.task.id, { assignedToStaffId: manager2.id }, IP, db), /Only Other Manager can take/);
    await rejects("A Manager cannot assign a delivery to the Owner", () => assignDeliveryTask(manager, s1.task.id, { assignedToStaffId: owner.id }, IP, db), /Only Settings Owner can take/);
    const s2 = await newOrder();
    const batch = await batchAssignDeliveryTasks(owner, { taskIds: [s2.task.id], assignedToStaffId: owner.id }, IP, db);
    assert(batch.assignedCount === 1 && batch.assignedStaffId === owner.id, "Owner can take deliveries themselves (bulk)");
    const next = await newOrder();
    assert(next.task.assignedTo === D1.id, "The next order still goes to the default partner (override did not change the default)");
    assert((await getSettings(db, true)).delivery.defaultDriverId === D1.id, "Default partner setting unchanged");
    const tasksForOrder = await db.queryOne<any>(
      "SELECT COUNT(*) AS n FROM delivery_tasks WHERE customer_phone = ? AND service_date = ? AND meal_type = 'LUNCH'",
      [s1.task.customerPhone, day]
    );
    assert(Number(tasksForOrder.n) === 1, "Reassignment created no second delivery for the order");
    const driverView = await listDeliveryTasks(D1, { serviceDate: day, mealType: "LUNCH" }, db);
    assert(!driverView.some((x) => x.id === s1.task.id), "The delivery no longer shows on the driver's phone list");
    const lines = s1d.task.orderLines!;
    const done = await completeDeliveryTask(manager, s1.task.id, {
      lines: lines.map((l) => ({ orderItemId: l.orderItemId, deliveredQuantity: l.quantity, undeliveredQuantity: 0 })),
      recipientName: "Customer", collectedAmount: 80, paymentMethod: "CASH", idempotencyKey: `sa_done_${rnd()}`,
    } as any, IP, db);
    assert(done.status === "DELIVERED" && done.collectedAmount === 80, "The Manager records the delivery and the ₹80 they collected");
    const custody = await db.queryOne<any>("SELECT collected_by FROM delivery_collections WHERE delivery_task_id = ?", [s1.task.id]);
    assert(custody?.collected_by === manager.id, "The cash is in the Manager's custody, not the driver's");
    const managerPerms = Array.from(getRolePermissions("OPERATIONS_MANAGER")).sort().join(",");
    assert(
      managerPerms === "audit.read,delivery.manage,delivery.read,delivery.update,finance.read,finance.record,kitchen.manage,kitchen.read,residents.manage,residents.read,rooms.manage,rooms.read,staff.read,tiffin.manage,tiffin.read",
      "Manager permissions are exactly as before (taking a delivery grants no new role or permission)"
    );
  } finally {
    await db.execute(`DELETE FROM business_settings WHERE key IN (${SET_KEYS.map(() => "?").join(", ")})`, SET_KEYS);
    clearSettingsCache();
  }

  console.log(`\nPG SETTINGS AND ASSIGNMENT: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
