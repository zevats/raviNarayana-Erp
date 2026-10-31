import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { batchDispatchDeliveryTasks } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const result = await batchDispatchDeliveryTasks(
      user,
      {
        taskIds: body.taskIds,
      },
      clientIp
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/tasks/batch-dispatch", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to batch dispatch delivery tasks." },
      { status: 400 }
    );
  }
}
