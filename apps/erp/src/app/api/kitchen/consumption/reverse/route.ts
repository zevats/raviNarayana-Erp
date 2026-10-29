import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { reverseProductionConsumption } from "@/server/kitchen/kitchenInventoryService";
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
    if (!body.reason || !body.reason.trim()) {
      return NextResponse.json({ error: "Reversal reason is mandatory" }, { status: 400 });
    }

    const consumption = await reverseProductionConsumption(
      user,
      body.planId,
      body.reason,
      clientIp
    );

    return NextResponse.json({ success: true, consumption });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json(
      { error: error.message || "Failed to reverse production consumption" },
      { status: 400 }
    );
  }
}
