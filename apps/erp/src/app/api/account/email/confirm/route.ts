import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { confirmEmailChange } from "@/server/account/accountService";
import { accountClient, accountError } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** { requestId, currentCode, newCode }: changes the email once both codes are right. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await confirmEmailChange(user, { requestId: body.requestId, currentCode: body.currentCode, newCode: body.newCode }, accountClient(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return accountError("/api/account/email/confirm", error);
  }
}
