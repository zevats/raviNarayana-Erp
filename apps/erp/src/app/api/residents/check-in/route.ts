import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { assignResidentToRoom } from "@/server/residents/residentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const stay = assignResidentToRoom(
      user,
      {
        residentId: body.residentId,
        roomId: body.roomId,
        checkInDate: body.checkInDate,
        monthlyRent: body.monthlyRent,
        securityDeposit: body.securityDeposit,
      },
      clientIp
    );

    return NextResponse.json({ success: true, stay }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to check in resident." }, { status: 400 });
  }
}
