import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { previewProductionConsumption } from "@/server/kitchen/kitchenInventoryService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const planId = url.searchParams.get("planId");

    if (!planId) {
      return NextResponse.json({ error: "Query parameter 'planId' is required" }, { status: 400 });
    }

    const preview = await previewProductionConsumption(user, planId);
    return NextResponse.json({ success: true, preview });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to preview consumption") }, { status: 400 });
  }
}
