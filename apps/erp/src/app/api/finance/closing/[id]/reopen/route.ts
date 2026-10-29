import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { reopenDailyClosing } from "@/server/finance/cashbookClosingService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const closingId = params.id;
    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const closing = await reopenDailyClosing(
      user,
      { closingId, reason: body.reason },
      clientIp
    );

    return NextResponse.json({ success: true, closing });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to reopen daily closing." },
      { status: 400 }
    );
  }
}
