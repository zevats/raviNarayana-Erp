import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { transferResidentRoom } from "@/server/residents/residentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const result = await transferResidentRoom(
      user,
      {
        residentId: body.residentId,
        targetRoomId: body.targetRoomId,
        transferDate: body.transferDate,
        newMonthlyRent: body.newMonthlyRent !== undefined ? Number(body.newMonthlyRent) : undefined,
        reason: body.reason,
        bedId: typeof body.bedId === "string" && body.bedId ? body.bedId : null,
      },
      clientIp
    );

    return NextResponse.json({ success: true, transfer: result }, { status: 200 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to transfer resident room." },
      { status: 400 }
    );
  }
}
