import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { confirmPasswordChange } from "@/server/account/accountService";
import { accountClient, accountError, currentTokenHash } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** { requestId, code, newPassword }: sets the new password and signs out other devices. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await confirmPasswordChange(user, { requestId: body.requestId, code: body.code, newPassword: body.newPassword }, accountClient(request), currentTokenHash(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return accountError("/api/account/password/confirm", error);
  }
}
