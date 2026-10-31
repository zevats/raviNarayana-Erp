import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { startPasswordChange } from "@/server/account/accountService";
import { accountClient, accountError } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** { currentPassword, newPassword }: checks both, then emails a code to the current address. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await startPasswordChange(user, { currentPassword: body.currentPassword, newPassword: body.newPassword }, accountClient(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return accountError("/api/account/password/request", error);
  }
}
