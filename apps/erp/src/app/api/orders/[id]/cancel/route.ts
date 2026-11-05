import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { cancelOrder } from "@/server/orders/orderLifecycleService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Cancels a delivery order with no money collected: { reason, overrideCutoff? }. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await cancelOrder(user, params.id, { reason: body.reason, overrideCutoff: body.overrideCutoff === true }, getClientIp(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders/[id]/cancel", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Could not cancel the order." }, { status: error.statusCode === 409 ? 409 : 400 });
  }
}
