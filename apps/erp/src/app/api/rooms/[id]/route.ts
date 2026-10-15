import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getRoomById, updateRoom, setRoomActiveStatus, deleteRoom } from "@/server/rooms/roomService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const room = getRoomById(user, params.id);
    if (!room) {
      return NextResponse.json({ error: `Room '${params.id}' not found.` }, { status: 404 });
    }

    return NextResponse.json({ success: true, room });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to retrieve room." }, { status: 400 });
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

    if (body.isActive !== undefined && typeof body.isActive === "boolean") {
      setRoomActiveStatus(user, params.id, body.isActive, clientIp);
    }

    const updated = updateRoom(
      user,
      params.id,
      {
        roomNumber: body.roomNumber,
        floor: body.floor,
        type: body.type,
        capacity: body.capacity,
        baseRentMonthly: body.baseRentMonthly,
      },
      clientIp
    );

    return NextResponse.json({ success: true, room: updated });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const msg = error.message || "Failed to update room.";
    const status = msg.includes("already exists") ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    deleteRoom(user, params.id, clientIp);

    return NextResponse.json({ success: true, message: "Room deleted successfully." });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to delete room." }, { status: 400 });
  }
}

