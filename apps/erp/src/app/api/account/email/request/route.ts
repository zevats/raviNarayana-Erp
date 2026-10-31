import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { startEmailChange } from "@/server/account/accountService";
import { accountClient, accountError } from "@/server/account/accountRoute";

export const dynamic = "force-dynamic";

/** { newEmail, currentPassword }: sends one code to the current email and one to the new address. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await startEmailChange(user, { newEmail: body.newEmail, currentPassword: body.currentPassword }, accountClient(request));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return accountError("/api/account/email/request", error);
  }
}
