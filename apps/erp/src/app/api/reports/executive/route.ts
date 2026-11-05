import { NextRequest, NextResponse } from "next/server";
import { businessToday } from "@/lib/businessDate";
import { RENT_SETTLEMENT_SQL, TIFFIN_RECEIPT_SQL, getDepositsHeld, getOutstandingRent } from "@/server/finance/financialDefinitions";
import { cookies } from "next/headers";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { getAsyncDb } from "@/server/database/db";

export const dynamic = "force-dynamic";

function sanitizeCsvCell(value: string | number): string {
  const str = String(value ?? "");
  // Formula injection prevention (guard against =, +, -, @, tab, CR)
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value || "";
    const user = await validateSession(sessionToken);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (
      user.role !== "SUPER_ADMIN" &&
      user.role !== "OPERATIONS_MANAGER" &&
      user.role !== "ACCOUNTANT"
    ) {
      return NextResponse.json(
        { error: "Forbidden: Executive report requires authorized management role" },
        { status: 403 }
      );
    }

    const db = getAsyncDb();
    const url = new URL(request.url);
    const startDateParam = url.searchParams.get("startDate") || undefined;
    const endDateParam = url.searchParams.get("endDate") || undefined;
    const division = (url.searchParams.get("division") as "COMBINED" | "PG" | "TIFFIN") || "COMBINED";

    const todayIso = businessToday();
    const currentMonthPrefix = todayIso.slice(0, 7);
    const startDate = startDateParam || `${currentMonthPrefix}-01`;
    const endDate = endDateParam || todayIso;

    // 1. Rooms & Occupancy
    const roomRow = await db.queryOne<{ totalRooms: number | string; totalCapacity: number | string }>(`
      SELECT 
        COUNT(*) as "totalRooms",
        COALESCE(SUM(capacity), 0) as "totalCapacity"
      FROM rooms
      WHERE is_active = 1
    `);

    const activeStaysRow = await db.queryOne<{ occupiedBeds: number | string }>(`
      SELECT COUNT(*) as "occupiedBeds"
      FROM resident_stays
      WHERE status = 'ACTIVE'
    `);

    const totalRooms = division === "TIFFIN" ? 0 : Number(roomRow?.totalRooms || 0);
    const totalCapacity = division === "TIFFIN" ? 0 : Number(roomRow?.totalCapacity || 0);
    const occupiedBeds = division === "TIFFIN" ? 0 : Number(activeStaysRow?.occupiedBeds || 0);
    const availableBeds = Math.max(0, totalCapacity - occupiedBeds);
    const occupancyRate = totalCapacity > 0 ? ((occupiedBeds / totalCapacity) * 100).toFixed(1) : "0.0";

    // 2. Finance
    const finSummary = await db.queryOne<{
      totalRentCollected: number | string;
      totalRentBilled: number | string;
      totalExpensesPaid: number | string;
      pgExpensesPaid: number | string;
      tiffinExpensesPaid: number | string;
      totalTiffinCollected: number | string;
    }>(`
      SELECT
        COALESCE(SUM(CASE WHEN ${RENT_SETTLEMENT_SQL} AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalRentCollected",
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalRentBilled",
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalExpensesPaid",
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES') AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "pgExpensesPaid",
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "tiffinExpensesPaid",
        COALESCE(SUM(CASE WHEN ${TIFFIN_RECEIPT_SQL} AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalTiffinCollected"
      FROM financial_transactions
    `);

    const rentMonthRow = await db.queryOne<{ rentMonth: number | string }>(`
      SELECT COALESCE(SUM(amount), 0) as "rentMonth"
      FROM financial_transactions
      WHERE ${RENT_SETTLEMENT_SQL} AND status = 'POSTED' AND transaction_date >= ? AND transaction_date <= ?
    `, [startDate, endDate]);

    const expMonthRow = await db.queryOne<{ expMonth: number | string }>(`
      SELECT COALESCE(SUM(amount), 0) as "expMonth"
      FROM financial_transactions
      WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' AND transaction_date >= ? AND transaction_date <= ?
    `, [startDate, endDate]);

    // Tiffin Revenue & Attributable Operating Costs
    const kitchenCostRow = await db.queryOne<{ kitchenCost: number | string }>(`
      SELECT COALESCE(SUM(amount), 0) as "kitchenCost"
      FROM financial_transactions
      WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' 
        AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') 
        AND transaction_date >= ? AND transaction_date <= ?
    `, [startDate, endDate]);

    const tiffinRevRow = await db.queryOne<{ tiffinRev: number | string }>(`
      SELECT COALESCE(SUM(amount), 0) as "tiffinRev"
      FROM financial_transactions
      WHERE ${TIFFIN_RECEIPT_SQL} AND status = 'POSTED'
        AND transaction_date >= ? AND transaction_date <= ?
    `, [startDate, endDate]);

    const totalRentCollected = division === "TIFFIN" ? 0 : Number(finSummary?.totalRentCollected || 0);
    const totalRentBilled = division === "TIFFIN" ? 0 : Number(finSummary?.totalRentBilled || 0);
    const totalExpensesPaid = division === "PG"
      ? Number(finSummary?.pgExpensesPaid || 0)
      : division === "TIFFIN"
      ? Number(finSummary?.tiffinExpensesPaid || 0)
      : Number(finSummary?.totalExpensesPaid || 0);
    const totalDepositsHeld = division === "TIFFIN" ? 0 : await getDepositsHeld(db);
    const currentMonthRent = division === "TIFFIN" ? 0 : Number(rentMonthRow?.rentMonth || 0);
    const currentMonthExp = Number(expMonthRow?.expMonth || 0);
    const outstanding = division === "TIFFIN" ? { total: 0, residents: 0 } : await getOutstandingRent(db);
    const outstandingRent = outstanding.total;
    const overdueCount = outstanding.residents;
    const kitchenCosts = division === "PG" ? 0 : Number(kitchenCostRow?.kitchenCost || 0);
    const tiffinRevenue = division === "PG" ? 0 : Number(tiffinRevRow?.tiffinRev || 0);
    const tiffinNetResult = tiffinRevenue - kitchenCosts;

    // 3. Kitchen Operations
    let targetKitchenDate = todayIso;
    let mealPlans = await db.query<{ meal_type: string; status: string; final_preparation_count: number | string }>(`
      SELECT meal_type, status, final_preparation_count
      FROM daily_meal_plans
      WHERE service_date = ?
    `, [targetKitchenDate]);

    if (mealPlans.length === 0) {
      const latestKitchenDate = await db.queryOne<{ service_date: string }>(`
        SELECT service_date FROM daily_meal_plans ORDER BY service_date DESC LIMIT 1
      `);
      if (latestKitchenDate) {
        targetKitchenDate = latestKitchenDate.service_date;
        mealPlans = await db.query<{ meal_type: string; status: string; final_preparation_count: number | string }>(`
          SELECT meal_type, status, final_preparation_count
          FROM daily_meal_plans
          WHERE service_date = ?
        `, [targetKitchenDate]);
      }
    }

    let breakfastCount = 0;
    let lunchCount = 0;
    let dinnerCount = 0;
    let totalMeals = 0;
    for (const p of mealPlans) {
      const count = Number(p.final_preparation_count);
      totalMeals += count;
      if (p.meal_type === "BREAKFAST") breakfastCount = count;
      if (p.meal_type === "LUNCH") lunchCount = count;
      if (p.meal_type === "DINNER") dinnerCount = count;
    }

    // 4. Delivery Operations
    let targetDeliveryDate = todayIso;
    let delStatusRows = await db.query<{ status: string; count: number | string }>(`
      SELECT status, COUNT(*) as count
      FROM delivery_tasks
      WHERE service_date = ?
      GROUP BY status
    `, [targetDeliveryDate]);

    if (delStatusRows.length === 0) {
      const latestDelDate = await db.queryOne<{ service_date: string }>(`
        SELECT service_date FROM delivery_tasks ORDER BY service_date DESC LIMIT 1
      `);
      if (latestDelDate) {
        targetDeliveryDate = latestDelDate.service_date;
        delStatusRows = await db.query<{ status: string; count: number | string }>(`
          SELECT status, COUNT(*) as count
          FROM delivery_tasks
          WHERE service_date = ?
          GROUP BY status
        `, [targetDeliveryDate]);
      }
    }

    const delMap: Record<string, number> = {};
    let totalDeliveryTasks = 0;
    for (const row of delStatusRows) {
      const cnt = Number(row.count);
      delMap[row.status] = cnt;
      totalDeliveryTasks += cnt;
    }

    const deliveredCount = delMap["DELIVERED"] || 0;
    const outCount = delMap["OUT_FOR_DELIVERY"] || 0;
    const assignedCount = delMap["ASSIGNED"] || 0;
    const pendingCount = delMap["PENDING"] || 0;
    const exceptionsCount = delMap["EXCEPTION"] || 0;
    const delCompletionRate = totalDeliveryTasks > 0 ? ((deliveredCount / totalDeliveryTasks) * 100).toFixed(1) : "0.0";

    // Format CSV lines
    const rows: (string | number)[][] = [
      ["Ravinarayan PG Guesthouse - Executive Operations & Financial Summary"],
      ["Generated At", new Date().toISOString(), "ISO-8601 Timestamp"],
      ["Prepared For", user.fullName, user.role],
      ["Reporting Period", `${startDate} to ${endDate}`, `Division: ${division}`],
      [],
      ["SECTION", "METRIC", "VALUE", "UNIT / NOTES"],
      // Occupancy
      ["Room Inventory & Occupancy", "Total Active Rooms", totalRooms, "Active rooms in property"],
      ["Room Inventory & Occupancy", "Total Bed Capacity", totalCapacity, "Maximum operational beds"],
      ["Room Inventory & Occupancy", "Occupied Beds", occupiedBeds, "Active resident stays"],
      ["Room Inventory & Occupancy", "Available Beds", availableBeds, "Vacant beds available for check-in"],
      ["Room Inventory & Occupancy", "Bed Occupancy Rate", `${occupancyRate}%`, "Occupied / Capacity"],
      // Finance
      ["Financial Performance", "Current Month Rent Collected", currentMonthRent, "INR (Posted rent payments)"],
      ["Financial Performance", "Total Rent Collected (All Time)", totalRentCollected, "INR (All posted rent payments)"],
      ["Financial Performance", "Total Rent Billed (All Time)", totalRentBilled, "INR (All posted rent charges)"],
      ["Financial Performance", "Outstanding Rent Balance", outstandingRent, "INR (Unpaid rent dues)"],
      ["Financial Performance", "Accounts with Overdue Rent", overdueCount, "Resident accounts requiring collection"],
      ["Financial Performance", "Security Deposits Held", totalDepositsHeld, "INR (Separate custodial liabilities)"],
      ["Financial Performance", "Current Month Total Expenses", currentMonthExp, "INR (Operating expenses)"],
      ["Financial Performance", "Total Expenses Paid (All Time)", totalExpensesPaid, "INR (All posted expenses)"],
      // Kitchen & Tiffin
      ["Tiffin Operations & Kitchen", "Current Month Tiffin Revenue", tiffinRevenue, "INR (Attributable meal payments)"],
      ["Tiffin Operations & Kitchen", "Attributable Kitchen Costs", kitchenCosts, "INR (Grocery & kitchen supplies)"],
      ["Tiffin Operations & Kitchen", "Net Tiffin Operating Result", tiffinNetResult, "INR (Revenue minus kitchen costs)"],
      ["Tiffin Operations & Kitchen", "Service Date Evaluated", targetKitchenDate, "Operational date"],
      ["Tiffin Operations & Kitchen", "Breakfast Preparation Count", breakfastCount, "Portions prepared/planned"],
      ["Tiffin Operations & Kitchen", "Lunch Preparation Count", lunchCount, "Portions prepared/planned"],
      ["Tiffin Operations & Kitchen", "Dinner Preparation Count", dinnerCount, "Portions prepared/planned"],
      ["Tiffin Operations & Kitchen", "Total Planned Meals", totalMeals, "Sum of all meal plans"],
      // Delivery Operations
      ["Delivery Fulfillment", "Service Date Evaluated", targetDeliveryDate, "Operational date"],
      ["Delivery Fulfillment", "Total Delivery Tasks", totalDeliveryTasks, "Total scheduled deliveries"],
      ["Delivery Fulfillment", "Delivered Successfully", deliveredCount, "Handed over to residents"],
      ["Delivery Fulfillment", "Out for Delivery", outCount, "In-transit with delivery staff"],
      ["Delivery Fulfillment", "Assigned to Staff", assignedCount, "Assigned awaiting dispatch"],
      ["Delivery Fulfillment", "Pending Assignment", pendingCount, "Awaiting staff assignment"],
      ["Delivery Fulfillment", "Active Delivery Exceptions", exceptionsCount, "Require review or authorized retry"],
      ["Delivery Fulfillment", "Delivery Completion Rate", `${delCompletionRate}%`, "Delivered / Total tasks"],
    ];

    const csvContent = rows
      .map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(","))
      .join("\r\n");

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ravinarayan_executive_report_${todayIso}.csv"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Executive report generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate executive report" },
      { status: 500 }
    );
  }
}
