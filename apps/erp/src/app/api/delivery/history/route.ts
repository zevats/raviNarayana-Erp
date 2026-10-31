import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { getDeliveryHistory } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";

export const dynamic = "force-dynamic";

/** Per date and meal outcome counts: ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most two months). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const url = new URL(request.url);
    const days = await getDeliveryHistory(user, url.searchParams.get("from") || "", url.searchParams.get("to") || "");
    return NextResponse.json({ days });
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/history", error, "Could not load the delivery history.");
  }
}
