import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { getDeliveryCloseout } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";
import { getBusinessDateString } from "@/server/finance/financeService";
import { MealType } from "@/types";

export const dynamic = "force-dynamic";

/** Day close-out (Owner / Manager): items, money and custody for a date and meal (or ALL). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const url = new URL(request.url);
    const closeout = await getDeliveryCloseout(
      user,
      url.searchParams.get("serviceDate") || getBusinessDateString(),
      (url.searchParams.get("mealType") as MealType | "ALL") || "ALL"
    );
    return NextResponse.json(closeout);
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/closeout", error, "Could not load the close-out.");
  }
}
