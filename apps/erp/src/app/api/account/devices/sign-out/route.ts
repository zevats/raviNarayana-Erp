import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { signOutOtherDevices } from "@/server/account/accountService";
import { accountClient, accountError, currentTokenHash } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** Signs out every other device of this account (this one stays signed in). */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await signOutOtherDevices(user, accountClient(request), currentTokenHash(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return accountError("/api/account/devices/sign-out", error);
  }
}
