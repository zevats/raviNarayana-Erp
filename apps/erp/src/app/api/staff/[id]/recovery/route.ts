import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { initiateStaffPasswordRecovery } from "@/server/staff/staffService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const origin = request.headers.get("origin") || undefined;
    const clientIp = getClientIp(request);

    const result = await initiateStaffPasswordRecovery(user, params.id, origin, clientIp);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to initiate password recovery.") },
      { status: 400 }
    );
  }
}
