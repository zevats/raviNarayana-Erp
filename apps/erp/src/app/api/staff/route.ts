import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listStaffUsers,
  createStaffUser,
  getStaffStats,
} from "@/server/staff/staffService";
import { getClientIp } from "@/server/authentication/ip";
import { StaffRole } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const role = (url.searchParams.get("role") as StaffRole) || undefined;
    const statusParam = url.searchParams.get("status");
    const isActive =
      statusParam === "ACTIVE"
        ? true
        : statusParam === "DEACTIVATED"
        ? false
        : undefined;
    const search = url.searchParams.get("search") || undefined;

    const [staff, stats] = await Promise.all([
      listStaffUsers(user, { role, isActive, search }),
      getStaffStats(user),
    ]);

    return NextResponse.json({ success: true, staff, stats });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to load staff accounts.") },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const newStaff = await createStaffUser(user, body, clientIp);
    return NextResponse.json({ success: true, staff: newStaff }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to create staff account.";
    const status = msg.includes("already in use") || msg.includes("already registered") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
