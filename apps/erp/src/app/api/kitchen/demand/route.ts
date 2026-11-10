import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { calculateDailyKitchenDemand } from "@/server/kitchen/kitchenService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const serviceDate = url.searchParams.get("serviceDate") || new Date().toISOString().slice(0, 10);

    const demand = await calculateDailyKitchenDemand(user, serviceDate);

    return NextResponse.json({ success: true, demand });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to calculate kitchen demand.") },
      { status: 400 }
    );
  }
}
