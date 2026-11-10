import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { addBed } from "@/server/rooms/bedService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Adds a bed to the room: { label }. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const bed = await addBed(user, params.id, body.label, getClientIp(request));
    return NextResponse.json({ success: true, bed }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/rooms/[id]/beds", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not add the bed.") }, { status: error.statusCode === 409 ? 409 : 400 });
  }
}
