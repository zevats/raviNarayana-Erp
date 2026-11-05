import { getAsyncDb, AsyncDb } from "../database/db";
import { businessToday, businessMonthStart } from "@/lib/businessDate";
import { requirePermission } from "../authorization/authorize";
import { getCashbookSummary } from "../finance/financeService";
import {
  AuthenticatedUser,
  ClosingDivision,
  PaymentMethod,
  CANONICAL_PAYMENT_METHODS,
  MultiDivisionFinancialReport,
  DivisionFinancialMetrics,
  InvoiceAgeingReport,
  InvoiceAgeingItem,
  DebtorAgeingSummary,
  OperationalReconciliationReport,
  KitchenReconciliationSummary,
  InventoryReconciliationSummary,
  DeliveryReconciliationReportSummary,
  PropertyCapacityAuditReport,
  RoomCapacityAuditDetail,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateRange(startDate?: string, endDate?: string): { startDate: string; endDate: string } {
  const defaultStart = businessMonthStart();
  const defaultEnd = businessToday();

  const validStart = startDate && DATE_REGEX.test(startDate) ? startDate : defaultStart;
  const validEnd = endDate && DATE_REGEX.test(endDate) ? endDate : defaultEnd;

  return { startDate: validStart, endDate: validEnd };
}

/**
 * 1. MULTI-DIVISION FINANCIAL REPORT
 * Reconciles Combined, PG Guesthouse, and Commercial Tiffin figures side-by-side
 * with canonical payment method breakdowns and accounts receivable.
 */
export async function getMultiDivisionFinancialReport(
  actor: AuthenticatedUser,
  options: { startDate?: string; endDate?: string } = {},
  asyncDb?: AsyncDb
): Promise<MultiDivisionFinancialReport> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
  const { startDate, endDate } = normalizeDateRange(options.startDate, options.endDate);

  // Parallel cashbook summaries for COMBINED, PG, and TIFFIN
  const [combinedCash, pgCash, tiffinCash, channelRows, tiffinReceivableRow] = await Promise.all([
    getCashbookSummary(actor, { startDate, endDate, division: "COMBINED" }, db),
    getCashbookSummary(actor, { startDate, endDate, division: "PG" }, db),
    getCashbookSummary(actor, { startDate, endDate, division: "TIFFIN" }, db),
    db.query<any>(`
      SELECT
        payment_method,
        transaction_type,
        category,
        status,
        amount
      FROM financial_transactions
      WHERE transaction_date >= ? AND transaction_date <= ?
    `, [startDate, endDate]),
    db.queryOne<any>(`
      SELECT COALESCE(SUM(balance_due), 0) as balance
      FROM invoices
      WHERE invoice_category = 'TIFFIN'
        AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    `),
  ]);

  // Aggregate Payment Method Channel Movement Breakdown
  const channelBreakdown: Record<PaymentMethod, { inflow: number; outflow: number; net: number; count: number }> = {
    CASH: { inflow: 0, outflow: 0, net: 0, count: 0 },
    UPI: { inflow: 0, outflow: 0, net: 0, count: 0 },
    BANK_TRANSFER: { inflow: 0, outflow: 0, net: 0, count: 0 },
    CHEQUE: { inflow: 0, outflow: 0, net: 0, count: 0 },
    OTHER: { inflow: 0, outflow: 0, net: 0, count: 0 },
  };

  for (const row of channelRows) {
    const rawMethod = (row.payment_method as PaymentMethod) || "OTHER";
    const method = CANONICAL_PAYMENT_METHODS.includes(rawMethod) ? rawMethod : "OTHER";
    const amt = Number(row.amount || 0);

    if (row.status === "POSTED") {
      channelBreakdown[method].count += 1;
      if (
        (row.transaction_type === "RENT_PAYMENT" && row.category !== "DEPOSIT_APPLICATION") ||
        row.transaction_type === "SECURITY_DEPOSIT" ||
        row.transaction_type === "TIFFIN_PAYMENT"
      ) {
        channelBreakdown[method].inflow += amt;
        channelBreakdown[method].net += amt;
      } else if (row.transaction_type === "EXPENSE" || row.transaction_type === "DEPOSIT_REFUND") {
        channelBreakdown[method].outflow += amt;
        channelBreakdown[method].net -= amt;
      } else if (row.transaction_type === "REVERSAL") {
        // Reversal reduces inflow or outflow
        channelBreakdown[method].outflow += amt;
        channelBreakdown[method].net -= amt;
      }
    }
  }

  const outstandingTiffin = Number(tiffinReceivableRow?.balance || 0);

  const combinedMetrics: DivisionFinancialMetrics = {
    division: "COMBINED",
    totalRevenue: combinedCash.totalRentCollected + (combinedCash.totalTiffinCollected || 0),
    rentCollected: combinedCash.totalRentCollected,
    depositsCollected: combinedCash.totalDepositsCollected,
    depositRefunds: 0,
    tiffinCollected: combinedCash.totalTiffinCollected || 0,
    expensesPaid: combinedCash.totalExpensesPaid,
    netCashMovement: combinedCash.netCashMovement,
    receivablesBilled: combinedCash.totalRentBilledInPeriod,
    outstandingReceivables: combinedCash.totalOutstandingRent + outstandingTiffin,
    transactionCount: combinedCash.transactionCount,
  };

  const pgMetrics: DivisionFinancialMetrics = {
    division: "PG",
    totalRevenue: pgCash.totalRentCollected,
    rentCollected: pgCash.totalRentCollected,
    depositsCollected: pgCash.totalDepositsCollected,
    depositRefunds: 0,
    tiffinCollected: 0,
    expensesPaid: pgCash.totalExpensesPaid,
    netCashMovement: pgCash.netCashMovement,
    receivablesBilled: pgCash.totalRentBilledInPeriod,
    outstandingReceivables: pgCash.totalOutstandingRent,
    transactionCount: pgCash.transactionCount,
  };

  const tiffinMetrics: DivisionFinancialMetrics = {
    division: "TIFFIN",
    totalRevenue: tiffinCash.totalTiffinCollected || 0,
    rentCollected: 0,
    depositsCollected: 0,
    depositRefunds: 0,
    tiffinCollected: tiffinCash.totalTiffinCollected || 0,
    expensesPaid: tiffinCash.totalExpensesPaid,
    netCashMovement: tiffinCash.netCashMovement,
    receivablesBilled: 0,
    outstandingReceivables: outstandingTiffin,
    transactionCount: tiffinCash.transactionCount,
  };

  return {
    startDate,
    endDate,
    combined: combinedMetrics,
    pg: pgMetrics,
    tiffin: tiffinMetrics,
    channelBreakdown,
  };
}

/**
 * 2. ACCOUNTS RECEIVABLE INVOICE AGEING REPORT
 * Categorizes unpaid invoices into ageing buckets:
 * Current (not yet due), 1-30 days, 31-60 days, 61-90 days, 90+ days.
 */
export async function getInvoiceAgeingReport(
  actor: AuthenticatedUser,
  options: { division?: ClosingDivision; asOfDate?: string } = {},
  asyncDb?: AsyncDb
): Promise<InvoiceAgeingReport> {
  requirePermission(actor, "finance.read");

  const db = asyncDb ?? getAsyncDb();
  const division = options.division || "COMBINED";
  const defaultAsOf = businessToday();
  const asOfDate = options.asOfDate && DATE_REGEX.test(options.asOfDate) ? options.asOfDate : defaultAsOf;

  let divisionFilter = "";
  if (division === "PG") {
    divisionFilter = "AND i.invoice_category = 'RESIDENT'";
  } else if (division === "TIFFIN") {
    divisionFilter = "AND i.invoice_category = 'TIFFIN'";
  }

  const rows = await db.query<any>(`
    SELECT
      i.id as invoice_id,
      i.invoice_number,
      i.invoice_category,
      i.resident_id,
      i.customer_id,
      i.issue_date,
      i.due_date,
      i.total_amount,
      i.amount_paid as paid_amount,
      i.balance_due,
      i.status,
      r.full_name as resident_name,
      r.phone as resident_phone,
      tc.full_name as customer_name,
      tc.phone as customer_phone,
      rm.room_number
    FROM invoices i
    LEFT JOIN residents r ON i.resident_id = r.id
    LEFT JOIN tiffin_customers tc ON i.customer_id = tc.id
    LEFT JOIN resident_stays s ON i.stay_id = s.id
    LEFT JOIN rooms rm ON s.room_id = rm.id
    WHERE i.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
      AND i.balance_due > 0
      ${divisionFilter}
    ORDER BY i.due_date ASC, i.invoice_number ASC
  `);

  const asOfTime = new Date(`${asOfDate}T23:59:59.999Z`).getTime();

  const buckets = {
    current: { amount: 0, count: 0 },
    days1To30: { amount: 0, count: 0 },
    days31To60: { amount: 0, count: 0 },
    days61To90: { amount: 0, count: 0 },
    days90Plus: { amount: 0, count: 0 },
  };

  let totalOutstanding = 0;
  const debtorMap = new Map<string, DebtorAgeingSummary>();
  const invoiceItems: InvoiceAgeingItem[] = [];

  for (const row of rows) {
    const balDue = Number(row.balance_due || 0);
    const totAmt = Number(row.total_amount || 0);
    const pdAmt = Number(row.paid_amount || 0);
    const isResident = row.invoice_category === "RESIDENT";
    const recipientId = isResident ? row.resident_id || "" : row.customer_id || "";
    const recipientName = isResident ? row.resident_name || "Unknown Resident" : row.customer_name || "Unknown Customer";
    const phone = isResident ? row.resident_phone || null : row.customer_phone || null;
    const roomNumber = row.room_number || null;

    const dueTime = new Date(`${row.due_date}T23:59:59.999Z`).getTime();
    const diffMs = asOfTime - dueTime;
    const daysPastDue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    let bucket: "CURRENT" | "1_30" | "31_60" | "61_90" | "90_PLUS" = "CURRENT";

    if (row.due_date > asOfDate) {
      bucket = "CURRENT";
      buckets.current.amount += balDue;
      buckets.current.count += 1;
    } else if (daysPastDue >= 1 && daysPastDue <= 30) {
      bucket = "1_30";
      buckets.days1To30.amount += balDue;
      buckets.days1To30.count += 1;
    } else if (daysPastDue >= 31 && daysPastDue <= 60) {
      bucket = "31_60";
      buckets.days31To60.amount += balDue;
      buckets.days31To60.count += 1;
    } else if (daysPastDue >= 61 && daysPastDue <= 90) {
      bucket = "61_90";
      buckets.days61To90.amount += balDue;
      buckets.days61To90.count += 1;
    } else {
      bucket = "90_PLUS";
      buckets.days90Plus.amount += balDue;
      buckets.days90Plus.count += 1;
    }

    totalOutstanding += balDue;

    invoiceItems.push({
      invoiceId: row.invoice_id,
      invoiceNumber: row.invoice_number,
      category: row.invoice_category as "RESIDENT" | "TIFFIN",
      recipientId,
      recipientName,
      roomNumber,
      phone,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      daysPastDue,
      totalAmount: totAmt,
      paidAmount: pdAmt,
      balanceDue: balDue,
      bucket,
    });

    // Debtor aggregate
    if (!debtorMap.has(recipientId)) {
      debtorMap.set(recipientId, {
        recipientId,
        recipientName,
        category: row.invoice_category as "RESIDENT" | "TIFFIN",
        roomNumber,
        phone,
        current: 0,
        days1To30: 0,
        days31To60: 0,
        days61To90: 0,
        days90Plus: 0,
        totalBalanceDue: 0,
        invoiceCount: 0,
      });
    }

    const debtor = debtorMap.get(recipientId)!;
    debtor.invoiceCount += 1;
    debtor.totalBalanceDue += balDue;

    if (bucket === "CURRENT") debtor.current += balDue;
    else if (bucket === "1_30") debtor.days1To30 += balDue;
    else if (bucket === "31_60") debtor.days31To60 += balDue;
    else if (bucket === "61_90") debtor.days61To90 += balDue;
    else if (bucket === "90_PLUS") debtor.days90Plus += balDue;
  }

  const debtors = Array.from(debtorMap.values()).sort((a, b) => b.totalBalanceDue - a.totalBalanceDue);

  return {
    asOfDate,
    division,
    totalOutstanding,
    totalInvoices: rows.length,
    buckets,
    debtors,
    invoices: invoiceItems,
  };
}

/**
 * 3. OPERATIONAL RECONCILIATION REPORT
 * Correlates Kitchen Demand & Production, Raw Material Movements, and Delivery Fulfillment
 * across an operational date range.
 */
export async function getOperationalReconciliationReport(
  actor: AuthenticatedUser,
  options: { division?: ClosingDivision; startDate?: string; endDate?: string } = {},
  asyncDb?: AsyncDb
): Promise<OperationalReconciliationReport> {
  requirePermission(actor, "kitchen.read");

  const db = asyncDb ?? getAsyncDb();
  const division = options.division || "COMBINED";
  const { startDate, endDate } = normalizeDateRange(options.startDate, options.endDate);

  // A. Kitchen Production Query
  const mealPlans = await db.query<any>(`
    SELECT
      service_date,
      meal_type,
      status,
      COALESCE(planned_resident_count, 0) as planned_resident,
      COALESCE(planned_tiffin_count, 0) as planned_tiffin,
      COALESCE(final_preparation_count, 0) as final_prep,
      COALESCE(actual_cooked_count, final_preparation_count) as cooked,
      COALESCE(dispatched_count, 0) as dispatched,
      COALESCE(leftover_count, 0) as leftover,
      COALESCE(waste_count, 0) as waste
    FROM daily_meal_plans
    WHERE service_date >= ? AND service_date <= ?
  `, [startDate, endDate]);

  const kitchenSummary: KitchenReconciliationSummary = {
    totalPlannedPortions: 0,
    plannedResidentCount: 0,
    plannedTiffinCount: 0,
    actualCookedCount: 0,
    dispatchedCount: 0,
    leftoverCount: 0,
    wasteCount: 0,
    byMealType: {
      breakfast: { planned: 0, cooked: 0, dispatched: 0, leftovers: 0, waste: 0 },
      lunch: { planned: 0, cooked: 0, dispatched: 0, leftovers: 0, waste: 0 },
      dinner: { planned: 0, cooked: 0, dispatched: 0, leftovers: 0, waste: 0 },
    },
  };

  for (const plan of mealPlans) {
    const plannedRes = Number(plan.planned_resident || 0);
    const plannedTif = Number(plan.planned_tiffin || 0);
    const finalPrep = Number(plan.final_prep || 0);
    const cooked = Number(plan.cooked || 0);
    const dispatched = Number(plan.dispatched || 0);
    const leftover = Number(plan.leftover || 0);
    const waste = Number(plan.waste || 0);

    kitchenSummary.plannedResidentCount += plannedRes;
    kitchenSummary.plannedTiffinCount += plannedTif;
    kitchenSummary.totalPlannedPortions += finalPrep;
    kitchenSummary.actualCookedCount += cooked;
    kitchenSummary.dispatchedCount += dispatched;
    kitchenSummary.leftoverCount += leftover;
    kitchenSummary.wasteCount += waste;

    const mType = plan.meal_type === "BREAKFAST" ? "breakfast" : plan.meal_type === "LUNCH" ? "lunch" : "dinner";
    kitchenSummary.byMealType[mType].planned += finalPrep;
    kitchenSummary.byMealType[mType].cooked += cooked;
    kitchenSummary.byMealType[mType].dispatched += dispatched;
    kitchenSummary.byMealType[mType].leftovers += leftover;
    kitchenSummary.byMealType[mType].waste += waste;
  }

  // B. Raw Material Movements Query
  const stockMovements = await db.query<any>(`
    SELECT
      sm.id,
      sm.movement_type,
      sm.quantity_base,
      sm.material_id,
      sm.created_at,
      rm.name as material_name,
      rm.base_unit as unit
    FROM kitchen_stock_movements sm
    JOIN kitchen_raw_materials rm ON sm.material_id = rm.id
    WHERE substr(sm.created_at, 1, 10) >= ? AND substr(sm.created_at, 1, 10) <= ?
  `, [startDate, endDate]);

  let totalConsumptionMovements = 0;
  let totalWastageMovements = 0;
  let totalReceiptMovements = 0;
  let totalAdjustmentMovements = 0;
  let wasteCostInr = 0;
  let consumptionCostInr = 0;

  const consumedMaterialMap = new Map<string, { materialId: string; materialName: string; quantity: number; unit: string }>();
  const wastedMaterialMap = new Map<string, { materialId: string; materialName: string; quantity: number; unit: string; costInr: number }>();

  for (const mov of stockMovements) {
    const qty = Number(mov.quantity_base || 0);

    if (mov.movement_type === "PRODUCTION_CONSUMPTION") {
      totalConsumptionMovements += 1;
      const existing = consumedMaterialMap.get(mov.material_id) || {
        materialId: mov.material_id,
        materialName: mov.material_name,
        quantity: 0,
        unit: mov.unit,
      };
      existing.quantity += Math.abs(qty);
      consumedMaterialMap.set(mov.material_id, existing);
    } else if (mov.movement_type === "WASTE") {
      totalWastageMovements += 1;
      const existing = wastedMaterialMap.get(mov.material_id) || {
        materialId: mov.material_id,
        materialName: mov.material_name,
        quantity: 0,
        unit: mov.unit,
        costInr: 0,
      };
      existing.quantity += Math.abs(qty);
      wastedMaterialMap.set(mov.material_id, existing);
    } else if (mov.movement_type === "RECEIPT") {
      totalReceiptMovements += 1;
    } else if (mov.movement_type === "ADJUSTMENT_ADD" || mov.movement_type === "ADJUSTMENT_SUB") {
      totalAdjustmentMovements += 1;
    }
  }

  const inventorySummary: InventoryReconciliationSummary = {
    totalConsumptionMovements,
    totalWastageMovements,
    totalReceiptMovements,
    totalAdjustmentMovements,
    wasteCostInr,
    consumptionCostInr,
    topConsumedMaterials: Array.from(consumedMaterialMap.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    topWastedMaterials: Array.from(wastedMaterialMap.values()).sort((a, b) => b.costInr - a.costInr).slice(0, 5),
  };

  // C. Delivery Tasks Query
  let deliveryFilter = "";
  if (division === "PG") {
    deliveryFilter = "AND dt.order_type = 'RESIDENT'";
  } else if (division === "TIFFIN") {
    deliveryFilter = "AND dt.order_type = 'EXTERNAL'";
  }

  const deliveryTasks = await db.query<any>(`
    SELECT
      dt.order_type,
      dt.status
    FROM delivery_tasks dt
    WHERE dt.service_date >= ? AND dt.service_date <= ?
      ${deliveryFilter}
  `, [startDate, endDate]);

  let totalTasks = 0;
  let residentTasks = 0;
  let externalTasks = 0;
  let deliveredCount = 0;
  let outForDeliveryCount = 0;
  let assignedCount = 0;
  let pendingCount = 0;
  let exceptionCount = 0;

  for (const t of deliveryTasks) {
    totalTasks += 1;
    if (t.order_type === "RESIDENT") residentTasks += 1;
    else externalTasks += 1;

    if (t.status === "DELIVERED") deliveredCount += 1;
    else if (t.status === "OUT_FOR_DELIVERY") outForDeliveryCount += 1;
    else if (t.status === "ASSIGNED") assignedCount += 1;
    else if (t.status === "PENDING") pendingCount += 1;
    else if (t.status === "EXCEPTION") exceptionCount += 1;
  }

  const completionRate = totalTasks > 0 ? Math.round((deliveredCount / totalTasks) * 100) : 0;

  const deliverySummary: DeliveryReconciliationReportSummary = {
    totalTasks,
    residentTasks,
    externalTasks,
    deliveredCount,
    outForDeliveryCount,
    assignedCount,
    pendingCount,
    exceptionCount,
    completionRate,
  };

  return {
    startDate,
    endDate,
    division,
    kitchen: kitchenSummary,
    inventory: inventorySummary,
    delivery: deliverySummary,
  };
}

/**
 * 4. PROPERTY CAPACITY AUDIT REPORT
 * Explicitly breaks down Authoritative 22-Room Layout:
 * Confirmed physical beds (39) vs Provisioned capacity (41) with Master Suite M01 audit.
 */
export async function getPropertyCapacityAudit(
  actor: AuthenticatedUser,
  asyncDb?: AsyncDb
): Promise<PropertyCapacityAuditReport> {
  requirePermission(actor, "rooms.read");

  const db = asyncDb ?? getAsyncDb();

  const [roomRows, stayRows] = await Promise.all([
    db.query<any>(`
      SELECT
        id,
        room_number,
        floor,
        type,
        capacity,
        base_rent_monthly,
        is_active
      FROM rooms
      ORDER BY floor ASC, room_number ASC
    `),
    db.query<any>(`
      SELECT
        s.room_id,
        s.resident_id,
        r.full_name as resident_name,
        s.check_in_date
      FROM resident_stays s
      JOIN residents r ON s.resident_id = r.id
      WHERE s.status = 'ACTIVE'
    `),
  ]);

  const stayMap = new Map<string, Array<{ residentId: string; residentName: string; checkInDate: string }>>();
  for (const s of stayRows) {
    const list = stayMap.get(s.room_id) || [];
    list.push({
      residentId: s.resident_id,
      residentName: s.resident_name,
      checkInDate: s.check_in_date,
    });
    stayMap.set(s.room_id, list);
  }

  let totalCapacity = 0;
  let totalOccupiedBeds = 0;
  let activeRooms = 0;
  let m01Occupied = 0;

  const roomDetails: RoomCapacityAuditDetail[] = [];

  for (const r of roomRows) {
    const cap = Number(r.capacity || 0);
    const occupants = stayMap.get(r.id) || [];
    const occCount = occupants.length;
    const availBeds = Math.max(0, cap - occCount);
    const isActive = Boolean(r.is_active);

    if (isActive) {
      activeRooms += 1;
      totalCapacity += cap;
      totalOccupiedBeds += occCount;
    }

    let statusNotes = `${r.type} - Floor ${r.floor}`;
    if (r.room_number.toUpperCase() === "M01") {
      m01Occupied = occCount;
      statusNotes = "Master Suite M01: Capacity 2 provisioned in DB (1 or 2 beds pending physical owner confirmation)";
    }

    roomDetails.push({
      roomId: r.id,
      roomNumber: r.room_number,
      floor: Number(r.floor),
      type: r.type,
      capacity: cap,
      occupiedBeds: occCount,
      availableBeds: availBeds,
      isActive,
      statusNotes,
      occupants,
    });
  }

  const confirmedPhysicalBeds = 39; // OL1-OL5: 5, 001-008: 16, 101-102: 6, 103-108: 12
  const provisionedCapacity = totalCapacity; // 41
  const unconfirmedBeds = 2; // In suite M01
  const totalVacantBeds = Math.max(0, totalCapacity - totalOccupiedBeds);
  const occupancyRate = totalCapacity > 0 ? Math.round((totalOccupiedBeds / totalCapacity) * 100) : 0;

  return {
    totalRooms: roomRows.length,
    activeRooms,
    confirmedPhysicalBeds,
    provisionedCapacity,
    unconfirmedBeds,
    totalOccupiedBeds,
    totalVacantBeds,
    occupancyRate,
    masterSuiteStatus: {
      roomNumber: "M01",
      provisionedCapacity: 2,
      physicalSurveyRange: "1 to 2 beds (executive suite layout)",
      status: "PENDING_OWNER_CONFIRMATION",
      currentOccupancy: m01Occupied,
    },
    rooms: roomDetails,
  };
}
