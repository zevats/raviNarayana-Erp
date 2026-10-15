import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { checkOutResident } from "@/server/residents/residentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    checkOutResident(
      user,
      {
        residentId: body.residentId,
        checkOutDate: body.checkOutDate,
      },
      clientIp
    );

    return NextResponse.json({ success: true, message: "Resident successfully checked out." });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to check out resident." }, { status: 400 });
  }
}
