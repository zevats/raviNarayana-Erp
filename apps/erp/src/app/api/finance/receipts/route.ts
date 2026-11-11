import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { recordOtherReceipt } from "@/server/finance/otherReceiptService";

export const dynamic = "force-dynamic";

/** Cashbook → Receive → Other: money received that is not anyone's dues (Owner / Manager). */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await recordOtherReceipt(user, body, getClientIp(request));
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/receipts", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not record the payment.") }, { status: 400 });
  }
}
