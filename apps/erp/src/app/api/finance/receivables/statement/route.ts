import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { getAccountStatement } from "@/server/finance/receivablesService";

export const dynamic = "force-dynamic";

/** Account statement built from the source records (?key=&from=&to=). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const p = request.nextUrl.searchParams;
    const statement = await getAccountStatement(user, p.get("key") || "", { from: p.get("from") || undefined, to: p.get("to") || undefined });
    return NextResponse.json({ success: true, statement });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/receivables/statement", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to build the statement.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
