import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getResidentById, updateResident } from "@/server/residents/residentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const resident = getResidentById(user, params.id);
    if (!resident) {
      return NextResponse.json({ error: `Resident '${params.id}' not found.` }, { status: 404 });
    }

    return NextResponse.json({ success: true, resident });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to retrieve resident." }, { status: 400 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const resident = updateResident(user, params.id, body, clientIp);

    return NextResponse.json({ success: true, resident });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const status = error.message?.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: error.message || "Failed to update resident." }, { status });
  }
}
