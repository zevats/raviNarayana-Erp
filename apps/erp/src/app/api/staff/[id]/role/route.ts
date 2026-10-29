import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { updateStaffRole } from "@/server/staff/staffService";
import { getClientIp } from "@/server/authentication/ip";
import { StaffRole } from "@/types";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const newRole = body?.newRole as StaffRole;
    if (!newRole) {
      return NextResponse.json({ error: "newRole is required." }, { status: 400 });
    }

    const clientIp = getClientIp(request);
    await updateStaffRole(user, params.id, newRole, clientIp);

    return NextResponse.json({
      success: true,
      message: `Staff role successfully updated to ${newRole}.`,
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to update staff role.";
    const status = msg.includes("Privilege escalation") ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
