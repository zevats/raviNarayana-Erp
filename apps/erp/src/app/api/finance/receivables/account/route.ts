import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { getReceivableAccount } from "@/server/finance/receivablesService";

export const dynamic = "force-dynamic";

/** One account's open balances (?key=R:<resident> | C:<customer> | O:<order>). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const key = request.nextUrl.searchParams.get("key") || "";
    return NextResponse.json({ success: true, ...(await getReceivableAccount(user, key)) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/receivables/account", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Failed to load the account." }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
