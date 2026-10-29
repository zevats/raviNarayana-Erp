import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { resetStaffPassword } from "@/server/staff/staffService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const newPassword = body?.newPassword;
    if (!newPassword || typeof newPassword !== "string") {
      return NextResponse.json({ error: "newPassword string is required." }, { status: 400 });
    }

    const clientIp = getClientIp(request);
    await resetStaffPassword(user, params.id, newPassword, clientIp);

    return NextResponse.json({
      success: true,
      message: "Staff password reset successfully. All active sessions have been invalidated.",
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to reset staff password.";
    const status = msg.includes("Privilege restriction") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
