import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listResidents, registerResident } from "@/server/residents/residentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as any;
    const search = url.searchParams.get("search") || undefined;

    const residents = listResidents(user, { status, search });
    return NextResponse.json({ success: true, residents });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to load residents." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const resident = registerResident(
      user,
      {
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        emergencyContact: body.emergencyContact,
        notes: body.notes,
      },
      clientIp
    );

    return NextResponse.json({ success: true, resident }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to register resident." }, { status: 400 });
  }
}
