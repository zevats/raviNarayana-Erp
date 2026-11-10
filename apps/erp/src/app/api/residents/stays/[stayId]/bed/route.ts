import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { placeResidentInBed } from "@/server/rooms/bedService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Puts a current resident into a bed of their room: { bedId }. */
export async function POST(request: NextRequest, { params }: { params: { stayId: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    await placeResidentInBed(user, params.stayId, String(body.bedId || ""), getClientIp(request));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/residents/stays/[stayId]/bed", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not place the resident in that bed.") }, { status: error.statusCode === 409 ? 409 : 400 });
  }
}
