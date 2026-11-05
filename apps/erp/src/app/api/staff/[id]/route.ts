import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getStaffUserById,
  updateStaffProfile,
  deleteStaffUser,
} from "@/server/staff/staffService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const staff = await getStaffUserById(user, params.id);
    if (!staff) {
      return NextResponse.json({ error: `Staff member '${params.id}' not found.` }, { status: 404 });
    }

    return NextResponse.json({ success: true, staff });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to retrieve staff details." },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    await updateStaffProfile(user, params.id, body, clientIp);
    return NextResponse.json({ success: true, message: "Staff profile updated successfully." });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to update staff profile.";
    const status = msg.includes("already registered") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

/** Deletes an account with no history (Owner only); accounts with history are refused with 409. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    await deleteStaffUser(user, params.id, getClientIp(request));
    return NextResponse.json({ success: true, message: "Staff account deleted." });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to delete the staff account.";
    const status = msg.includes("not found") ? 404 : msg.includes("has history") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
