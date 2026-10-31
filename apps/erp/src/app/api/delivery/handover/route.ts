import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listDriverCashHandovers,
  getDriverCustodySummary,
  getFleetCustodySummary,
} from "@/server/delivery/deliveryService";
import { getAsyncDb } from "@/server/database/db";
import { getBusinessDateString } from "@/server/finance/financeService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const searchParams = request.nextUrl.searchParams;
    const isSummary = searchParams.get("summary") === "true";
    const rawDriverId = searchParams.get("driverId")?.trim();
    const shiftDate = searchParams.get("shiftDate") || getBusinessDateString();
    const status = searchParams.get("status") as any;

    if (isSummary) {
      const isDeliveryBoy = user.role === "DELIVERY_PERSON";

      if (isDeliveryBoy) {
        // Delivery Boy can only request their own custody summary
        const summary = await getDriverCustodySummary(user, user.id, shiftDate);
        return NextResponse.json({ success: true, summary });
      }

      // Owner (SUPER_ADMIN) or Manager (OPERATIONS_MANAGER) requesting custody summary
      const aggregate = searchParams.get("aggregate") === "true";
      const hasSpecificDriver = rawDriverId && rawDriverId !== "undefined" && rawDriverId !== "null";

      if (!hasSpecificDriver || aggregate) {
        // Explicit aggregate fleet custody across all active delivery drivers
        const summary = await getFleetCustodySummary(user, shiftDate);
        return NextResponse.json({ success: true, summary });
      }

      // Specific driver requested: Validate that the target staff member exists and is an active DELIVERY_PERSON
      const db = getAsyncDb();
      const staffRow = await db.queryOne<any>(`
        SELECT id, full_name as fullName, role, is_active as isActive
        FROM staff_users
        WHERE id = ?
      `, [rawDriverId]);

      if (!staffRow) {
        return NextResponse.json(
          { error: `Staff member '${rawDriverId}' not found.` },
          { status: 400 }
        );
      }

      if (staffRow.role !== "DELIVERY_PERSON") {
        return NextResponse.json(
          { error: `Staff member '${staffRow.fullName}' holds role '${staffRow.role}'. Driver-specific custody summary is only valid for delivery personnel.` },
          { status: 400 }
        );
      }

      const summary = await getDriverCustodySummary(user, rawDriverId, shiftDate);
      return NextResponse.json({ success: true, summary });
    }

    const handovers = await listDriverCashHandovers(user, {
      driverId: rawDriverId && rawDriverId !== "undefined" && rawDriverId !== "null" ? rawDriverId : undefined,
      shiftDate: searchParams.get("shiftDate") || undefined,
      status: status || undefined,
    });

    return NextResponse.json({ success: true, handovers });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/handover", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to retrieve handovers." },
      { status: 400 }
    );
  }
}
