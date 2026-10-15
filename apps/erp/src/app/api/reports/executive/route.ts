import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { getDb } from "@/server/database/db";

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
    const user = validateSession(sessionToken);

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

    const db = getDb();
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentMonthPrefix = todayIso.slice(0, 7);

    // 1. Rooms & Occupancy
    const roomRow = db.prepare(`
      SELECT 
        COUNT(*) as totalRooms,
        COALESCE(SUM(capacity), 0) as totalCapacity
      FROM rooms
      WHERE is_active = 1
    `).get() as { totalRooms: number; totalCapacity: number } | undefined;

    const activeStaysRow = db.prepare(`
      SELECT COUNT(*) as occupiedBeds
      FROM resident_stays
      WHERE status = 'ACTIVE'
    `).get() as { occupiedBeds: number } | undefined;

    const totalRooms = roomRow?.totalRooms || 0;
    const totalCapacity = roomRow?.totalCapacity || 0;
    const occupiedBeds = activeStaysRow?.occupiedBeds || 0;
    const availableBeds = Math.max(0, totalCapacity - occupiedBeds);
    const occupancyRate = totalCapacity > 0 ? ((occupiedBeds / totalCapacity) * 100).toFixed(1) : "0.0";

    // 2. Finance
    const finSummary = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalRentCollected,
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalRentBilled,
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalExpensesPaid,
        COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalDepositsHeld
      FROM financial_transactions
    `).get() as {
      totalRentCollected: number;
      totalRentBilled: number;
      totalExpensesPaid: number;
      totalDepositsHeld: number;
    } | undefined;

    const rentMonthRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as rentMonth
      FROM financial_transactions
      WHERE transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { rentMonth: number } | undefined;

    const expMonthRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as expMonth
      FROM financial_transactions
      WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { expMonth: number } | undefined;

    const overdueCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT r.id
        FROM residents r
        JOIN financial_transactions t ON t.resident_id = r.id AND t.status = 'POSTED'
        GROUP BY r.id
        HAVING (
          SUM(CASE WHEN t.transaction_type = 'RENT_CHARGE' THEN t.amount ELSE 0 END) -
          SUM(CASE WHEN t.transaction_type = 'RENT_PAYMENT' THEN t.amount ELSE 0 END)
        ) > 0
      )
    `).get() as { count: number } | undefined;

    // Tiffin Revenue & Attributable Operating Costs
    const kitchenCostRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as kitchenCost
      FROM financial_transactions
      WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' 
        AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') 
        AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { kitchenCost: number } | undefined;

    const tiffinRevRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as tiffinRev
      FROM financial_transactions
      WHERE transaction_type = 'RENT_PAYMENT' AND status = 'POSTED'
        AND (category = 'TIFFIN' OR description LIKE '%tiffin%')
        AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { tiffinRev: number } | undefined;

    const totalRentCollected = finSummary?.totalRentCollected || 0;
    const totalRentBilled = finSummary?.totalRentBilled || 0;
    const totalExpensesPaid = finSummary?.totalExpensesPaid || 0;
    const totalDepositsHeld = finSummary?.totalDepositsHeld || 0;
    const currentMonthRent = rentMonthRow?.rentMonth || 0;
    const currentMonthExp = expMonthRow?.expMonth || 0;
    const outstandingRent = Math.max(0, totalRentBilled - totalRentCollected);
    const overdueCount = overdueCountRow?.count || 0;
    const kitchenCosts = kitchenCostRow?.kitchenCost || 0;
    const tiffinRevenue = tiffinRevRow?.tiffinRev || 0;
    const tiffinNetResult = tiffinRevenue - kitchenCosts;

    // 3. Kitchen Operations
    let targetKitchenDate = todayIso;
    let mealPlans = db.prepare(`
      SELECT meal_type, status, final_preparation_count
      FROM daily_meal_plans
      WHERE service_date = ?
    `).all(targetKitchenDate) as { meal_type: string; status: string; final_preparation_count: number }[];

    if (mealPlans.length === 0) {
      const latestKitchenDate = db.prepare(`
        SELECT service_date FROM daily_meal_plans ORDER BY service_date DESC LIMIT 1
      `).get() as { service_date: string } | undefined;
      if (latestKitchenDate) {
        targetKitchenDate = latestKitchenDate.service_date;
        mealPlans = db.prepare(`
          SELECT meal_type, status, final_preparation_count
          FROM daily_meal_plans
          WHERE service_date = ?
        `).all(targetKitchenDate) as { meal_type: string; status: string; final_preparation_count: number }[];
      }
    }

    let breakfastCount = 0;
    let lunchCount = 0;
    let dinnerCount = 0;
    let totalMeals = 0;
    for (const p of mealPlans) {
      totalMeals += p.final_preparation_count;
      if (p.meal_type === "BREAKFAST") breakfastCount = p.final_preparation_count;
      if (p.meal_type === "LUNCH") lunchCount = p.final_preparation_count;
      if (p.meal_type === "DINNER") dinnerCount = p.final_preparation_count;
    }

    // 4. Delivery Operations
    let targetDeliveryDate = todayIso;
    let delStatusRows = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM delivery_tasks
      WHERE service_date = ?
      GROUP BY status
    `).all(targetDeliveryDate) as { status: string; count: number }[];

    if (delStatusRows.length === 0) {
      const latestDelDate = db.prepare(`
        SELECT service_date FROM delivery_tasks ORDER BY service_date DESC LIMIT 1
      `).get() as { service_date: string } | undefined;
      if (latestDelDate) {
        targetDeliveryDate = latestDelDate.service_date;
        delStatusRows = db.prepare(`
          SELECT status, COUNT(*) as count
          FROM delivery_tasks
          WHERE service_date = ?
          GROUP BY status
        `).all(targetDeliveryDate) as { status: string; count: number }[];
      }
    }

    const delMap: Record<string, number> = {};
    let totalDeliveryTasks = 0;
    for (const row of delStatusRows) {
      delMap[row.status] = row.count;
      totalDeliveryTasks += row.count;
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
      ["Prepared For", "Dr. Ravinder Gulia - Owner", "Super Admin"],
      ["Reporting Period", "Current Month (" + currentMonthPrefix + ")", "Active Operational Period"],
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
