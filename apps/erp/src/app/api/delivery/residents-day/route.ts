import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { listResidentMealDelivery, setResidentRoomDelivery, setResidentDaySkip } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";
import { getBusinessDateString } from "@/server/finance/financeService";
import { getClientIp } from "@/server/authentication/ip";
import { MealType } from "@/types";

export const dynamic = "force-dynamic";

/** Residents staying on the date, with room delivery and the arrangement for the meal. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const url = new URL(request.url);
    const listing = await listResidentMealDelivery(
      user,
      url.searchParams.get("serviceDate") || getBusinessDateString(),
      (url.searchParams.get("mealType") as MealType) || "LUNCH"
    );
    return NextResponse.json(listing);
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/residents-day", error, "Could not load resident meals.");
  }
}

/**
 * { residentId, lunch?, dinner? } sets the standing room delivery;
 * { residentId, serviceDate, mealType, action: "SKIP" | "CLEAR", reason? } skips the meal for that day.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const ip = getClientIp(request);
    if (body.action) {
      await setResidentDaySkip(
        user,
        { residentId: body.residentId, serviceDate: body.serviceDate, mealType: body.mealType, action: body.action, reason: body.reason },
        ip
      );
    } else {
      await setResidentRoomDelivery(
        user,
        {
          residentId: body.residentId,
          lunch: typeof body.lunch === "boolean" ? body.lunch : undefined,
          dinner: typeof body.dinner === "boolean" ? body.dinner : undefined,
        },
        ip
      );
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/residents-day", error, "Could not change the resident meal.");
  }
}
