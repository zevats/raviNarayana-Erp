import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  confirmProductionConsumption,
  InsufficientStockError,
} from "@/server/kitchen/kitchenInventoryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const clientIp = getClientIp(request);

    if (!body.planId) {
      return NextResponse.json({ error: "Missing required field 'planId'" }, { status: 400 });
    }

    const consumption = await confirmProductionConsumption(
      user,
      body.planId,
      body.notes,
      clientIp
    );

    return NextResponse.json({ success: true, consumption });
  } catch (error: any) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "INSUFFICIENT_STOCK",
          shortages: error.shortages,
        },
        { status: 422 }
      );
    }
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json(
      { error: error.message || "Failed to confirm production consumption" },
      { status: 400 }
    );
  }
}
