import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { resendAccountCodes } from "@/server/account/accountService";
import { accountClient, accountError } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** { requestId }: sends fresh codes for an open password or email change; replies with the new requestId. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await resendAccountCodes(user, { requestId: body.requestId }, accountClient(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return accountError("/api/account/resend", error);
  }
}
