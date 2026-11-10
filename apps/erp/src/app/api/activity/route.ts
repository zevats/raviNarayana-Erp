import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { listActivity, getActivityFilterOptions } from "@/server/audit/activityLogService";

export const dynamic = "force-dynamic";

/** Activity log (Owner only, read-only). Query: actorId, action, area, targetId, from, to, search, limit, offset, options=1. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const p = new URL(request.url).searchParams;
    if (p.get("options") === "1") return NextResponse.json({ success: true, ...(await getActivityFilterOptions(user)) });
    const result = await listActivity(user, {
      actorId: p.get("actorId") || undefined,
      action: p.get("action") || undefined,
      area: p.get("area") || undefined,
      targetId: p.get("targetId") || undefined,
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      search: p.get("search") || undefined,
      limit: Number(p.get("limit")) || undefined,
      offset: Number(p.get("offset")) || undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/activity", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not load the activity log.") }, { status: 400 });
  }
}
