import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { recordStockReceipt } from "@/server/kitchen/kitchenInventoryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const clientIp = getClientIp(request);

    const movement = await recordStockReceipt(user, body, clientIp);
    return NextResponse.json({ success: true, movement }, { status: 201 });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to record stock receipt") }, { status: 400 });
  }
}
