import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { getThaliSummary, declareThaliReturn, verifyThaliReturn, reportThaliDamage, issueSpareThalis } from "@/server/delivery/thaliService";

export const dynamic = "force-dynamic";

/**
 * Thalis carried by staff (migration 0030).
 *   GET  → spare stock at the PG, who holds how many, returns to check (staff: their own only)
 *   POST { action: "return", quantity, note?, staffId? }        hand thalis back to the PG
 *        { action: "verify", moveId, receivedQuantity, note? }  owner/manager counts a return
 *        { action: "damage", quantity, note, staffId? }         thalis held that got damaged
 *        { action: "issue", staffId, quantity, note? }          spare thalis given for deliveries
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, ...(await getThaliSummary(user)) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/thalis", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not load the thalis.") }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const ip = getClientIp(request);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    const move =
      action === "return"
        ? await declareThaliReturn(user, body, ip)
        : action === "verify"
          ? await verifyThaliReturn(user, String(body.moveId || ""), body, ip)
          : action === "damage"
            ? await reportThaliDamage(user, body, ip)
            : action === "issue"
              ? await issueSpareThalis(user, body, ip)
              : null;
    if (!move) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json({ success: true, move });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/thalis", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not save.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
