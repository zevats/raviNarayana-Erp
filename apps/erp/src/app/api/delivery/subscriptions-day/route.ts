import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { listSubscriptionDay, setSubscriptionDayOverride } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";
import { getBusinessDateString } from "@/server/finance/financeService";
import { getClientIp } from "@/server/authentication/ip";
import { MealType } from "@/types";

export const dynamic = "force-dynamic";

/** Every active or paused subscription with its status for one date and meal. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const url = new URL(request.url);
    const listing = await listSubscriptionDay(
      user,
      url.searchParams.get("serviceDate") || getBusinessDateString(),
      (url.searchParams.get("mealType") as MealType) || "LUNCH"
    );
    return NextResponse.json(listing);
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/subscriptions-day", error, "Could not load the subscriptions for this meal.");
  }
}

/** Skip today / extra today / clear: { subscriptionId, serviceDate, mealType, action, quantity?, reason? }. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const row = await setSubscriptionDayOverride(
      user,
      {
        subscriptionId: body.subscriptionId,
        serviceDate: body.serviceDate,
        mealType: body.mealType,
        action: body.action,
        quantity: body.quantity,
        reason: body.reason,
      },
      getClientIp(request)
    );
    return NextResponse.json({ success: true, row });
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/subscriptions-day", error, "Could not change this subscription meal.");
  }
}
