import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { writeOffCashShortfall } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Owner only: write off part of an employee's unresolved cash shortage, with a reason. */
export async function POST(request: NextRequest, { params }: { params: { staffId: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const custody = await writeOffCashShortfall(user, params.staffId, { amount: body.amount, reason: body.reason }, getClientIp(request));
    return NextResponse.json({ success: true, custody });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/custody/write-off", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not write off the shortage.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
