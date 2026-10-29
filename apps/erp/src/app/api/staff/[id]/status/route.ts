import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { setStaffActiveStatus } from "@/server/staff/staffService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    if (body?.isActive === undefined) {
      return NextResponse.json({ error: "isActive boolean is required." }, { status: 400 });
    }

    const isActive = Boolean(body.isActive);
    const clientIp = getClientIp(request);
    await setStaffActiveStatus(user, params.id, isActive, clientIp);

    return NextResponse.json({
      success: true,
      message: isActive
        ? "Staff account activated successfully."
        : "Staff account deactivated successfully and all active sessions revoked.",
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to update staff status.";
    const status = msg.includes("sole remaining active Super Administrator") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
