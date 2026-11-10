import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { createCashHandoverDeclaration } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const handover = await createCashHandoverDeclaration(
      user,
      {
        driverId: body.driverId,
        shiftDate: body.shiftDate,
        declaredCash: body.declaredCash,
        notes: body.notes,
      },
      clientIp
    );

    return NextResponse.json({ success: true, handover });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/handover/declare", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to declare cash handover.") },
      { status: 400 }
    );
  }
}
