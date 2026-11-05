import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { startRoomMaintenance, completeRoomMaintenance, listRoomMaintenance } from "@/server/rooms/bedService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

function errorResponse(error: any, fallback: string) {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse("/api/rooms/[id]/maintenance", error);
  if (dbError) return dbError;
  return NextResponse.json({ error: error.message || fallback }, { status: error.statusCode === 409 ? 409 : 400 });
}

/** Maintenance history for the room, newest first. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, records: await listRoomMaintenance(user, params.id) });
  } catch (error: any) {
    return errorResponse(error, "Could not load the maintenance history.");
  }
}

/** { action: "start", reason, startDate? } or { action: "complete", endDate?, note? }. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const ip = getClientIp(request);
    if (body.action === "start") {
      return NextResponse.json({ success: true, record: await startRoomMaintenance(user, params.id, { reason: body.reason, startDate: body.startDate }, ip) }, { status: 201 });
    }
    if (body.action === "complete") {
      return NextResponse.json({ success: true, record: await completeRoomMaintenance(user, params.id, { endDate: body.endDate, note: body.note }, ip) });
    }
    return NextResponse.json({ error: "Choose start or complete." }, { status: 400 });
  } catch (error: any) {
    return errorResponse(error, "Could not update the maintenance.");
  }
}
