import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listActiveDeliveryStaff, getDefaultDeliveryStaff } from "@/server/delivery/deliveryService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const staff = await listActiveDeliveryStaff(user);
    // Who new orders go to by default, so the board can tell a per-order change from the default.
    const defaultStaff = await getDefaultDeliveryStaff();

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
