import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { getMyAccount } from "@/server/account/accountService";
import { accountError, currentTokenHash } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** The signed-in staff member's own profile and work summary. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json(await getMyAccount(user, currentTokenHash(request)));
  } catch (error: any) {
    return accountError("/api/account", error);
  }
}
