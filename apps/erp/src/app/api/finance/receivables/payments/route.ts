import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { receiveAccountPayment } from "@/server/finance/receivablesService";

export const dynamic = "force-dynamic";

/** Receive a payment for an account; each item is recorded by its own source (Owner / Manager). */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await receiveAccountPayment(user, body, getClientIp(request));
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/receivables/payments", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to record the payment.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
