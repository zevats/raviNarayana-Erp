import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { listReceivables } from "@/server/finance/receivablesService";

export const dynamic = "force-dynamic";

/** Finance → Receivables: summary, ageing and one page of accounts. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const p = request.nextUrl.searchParams;
    const result = await listReceivables(user, {
      source: (p.get("source") as any) || "ALL",
      q: p.get("q") || undefined,
      status: (p.get("status") as any) || "ALL",
      bucket: (p.get("bucket") as any) || "ALL",
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      reviewOnly: p.get("review") === "1",
      kind: (p.get("kind") as any) || undefined,
      customerType: p.get("customerType") || undefined,
      sort: (p.get("sort") as any) || undefined,
      limit: Number(p.get("limit")) || undefined,
      offset: Number(p.get("offset")) || undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/receivables", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to load receivables.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
