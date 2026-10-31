import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listStaffCustody, getStaffCustodyDetail } from "@/server/delivery/deliveryService";

export const dynamic = "force-dynamic";

/**
 * Staff-wise custody ledger.
 *   GET /api/delivery/custody            → one row per employee + totals (staff: own row only)
 *   GET /api/delivery/custody?staffId=…  → one employee's custody, collections and handovers
 * Ownership is enforced in the service: delivery staff can only read their own custody.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const staffId = request.nextUrl.searchParams.get("staffId")?.trim();
    if (staffId) {
      const detail = await getStaffCustodyDetail(user, staffId);
      return NextResponse.json({ success: true, ...detail });
    }
    const overview = await listStaffCustody(user);
    return NextResponse.json({ success: true, ...overview });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/custody", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Failed to load custody." }, { status: 400 });
  }
}
