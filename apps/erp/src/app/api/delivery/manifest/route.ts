import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { getManifestStatus, prepareDeliveryManifest } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";
import { getBusinessDateString } from "@/server/finance/financeService";
import { getClientIp } from "@/server/authentication/ip";
import { MealType } from "@/types";

export const dynamic = "force-dynamic";

/** Delivery list status for a date and meal. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const url = new URL(request.url);
    const status = await getManifestStatus(
      user,
      url.searchParams.get("serviceDate") || getBusinessDateString(),
      (url.searchParams.get("mealType") as MealType) || "LUNCH"
    );
    return NextResponse.json(status);
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/manifest", error, "Could not load the delivery list status.");
  }
}

/** Prepare the list: { serviceDate, mealType, trigger: "MANUAL" (Manager) | "AUTO" (on open, when due) }. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await prepareDeliveryManifest(
      user,
      { serviceDate: body.serviceDate, mealType: body.mealType, trigger: body.trigger === "AUTO" ? "AUTO" : "MANUAL" },
      getClientIp(request)
    );
    return NextResponse.json(result);
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/manifest", error, "Could not prepare the delivery list.");
  }
}
