import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { generateDeliveryTasks } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";
import { requireDeliveryOpsSchema } from "@/server/delivery/deliveryRules";
import { DeliveryOpsUnavailableError } from "@/server/delivery/deliveryRules";
import { getAsyncDb } from "@/server/database/db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);
    // The earlier generator made every resident meal a delivery stop; until migration 0014 is
    // installed (room delivery only) this endpoint is switched off.
    await requireDeliveryOpsSchema(getAsyncDb(), "Preparing the delivery list");

    const result = await generateDeliveryTasks(
      user,
      {
        serviceDate: body.serviceDate,
        mealType: body.mealType,
      },
      clientIp
    );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/tasks/generate", error);
    if (dbError) return dbError;
    if (error instanceof DeliveryOpsUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }

    return NextResponse.json(
      { error: error.message || "Failed to generate delivery tasks." },
      { status: 400 }
    );
  }
}
