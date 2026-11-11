import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { editTransaction } from "@/server/finance/entryEditService";

export const dynamic = "force-dynamic";

/** Edit a cashbook entry (details; or amount/date/method of an expense or Other receipt by correction). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await editTransaction(user, params.id, body, getClientIp(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/transactions/[id]", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not save the changes.") }, { status: 400 });
  }
}
