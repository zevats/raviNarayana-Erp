import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { retryDeliveryTask } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const task = await retryDeliveryTask(
      user,
      params.id,
      {
        reassignToStaffId: body.reassignToStaffId,
        notes: body.notes,
      },
      clientIp
    );

    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/tasks/[id]/retry", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to retry delivery task.") },
      { status: 400 }
    );
  }
}
