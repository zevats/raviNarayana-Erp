import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { reportDeliveryException } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const task = reportDeliveryException(
      user,
      params.id,
      {
        exceptionType: body.exceptionType,
        reason: body.reason,
      },
      clientIp
    );

    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to report delivery exception." },
      { status: 400 }
    );
  }
}
