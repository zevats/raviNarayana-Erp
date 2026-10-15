import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { generateDeliveryTasks } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const result = generateDeliveryTasks(
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

    return NextResponse.json(
      { error: error.message || "Failed to generate delivery tasks." },
      { status: 400 }
    );
  }
}
