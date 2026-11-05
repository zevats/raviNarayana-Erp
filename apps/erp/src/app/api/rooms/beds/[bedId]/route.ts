import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { updateBed, removeBed } from "@/server/rooms/bedService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

function errorResponse(error: any, fallback: string) {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse("/api/rooms/beds/[bedId]", error);
  if (dbError) return dbError;
  return NextResponse.json({ error: error.message || fallback }, { status: error.statusCode === 409 ? 409 : 400 });
}

/** Renames a bed or takes it out of / back into service: { label?, status?, notes? }. */
export async function PATCH(request: NextRequest, { params }: { params: { bedId: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const bed = await updateBed(user, params.bedId, { label: body.label, status: body.status, notes: body.notes }, getClientIp(request));
    return NextResponse.json({ success: true, bed });
  } catch (error: any) {
    return errorResponse(error, "Could not change the bed.");
  }
}

/** Removes a bed that was never used. */
export async function DELETE(request: NextRequest, { params }: { params: { bedId: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    await removeBed(user, params.bedId, getClientIp(request));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return errorResponse(error, "Could not remove the bed.");
  }
}
