import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listActiveDeliveryStaff, getDefaultDeliveryStaff, listAssignableStaff } from "@/server/delivery/deliveryService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    // ?all=1: everyone a delivery can be given to (the order form's "Assign to").
    const all = request.nextUrl.searchParams.get("all") === "1";
    const [staff, defaultStaff] = await Promise.all([all ? listAssignableStaff(user) : listActiveDeliveryStaff(user), getDefaultDeliveryStaff()]);
    // Who new orders go to by default, so the board can tell a per-order change from the default.
    return NextResponse.json({ success: true, staff, defaultStaffId: defaultStaff?.id ?? null });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/staff", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to load delivery staff.") },
      { status: 400 }
    );
  }
}
