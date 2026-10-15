import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listRooms, createRoom } from "@/server/rooms/roomService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const floorParam = url.searchParams.get("floor");
    const floor = floorParam !== null && floorParam !== "" ? Number(floorParam) : undefined;
    const status = url.searchParams.get("status") as any;
    const search = url.searchParams.get("search") || undefined;

    const rooms = listRooms(user, { floor, status, search });
    return NextResponse.json({ success: true, rooms });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to load rooms." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const room = createRoom(user, body, clientIp);
    return NextResponse.json({ success: true, room }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to create room.";
    const status = msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
