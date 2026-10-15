import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getDeliveryDashboardSummary } from "@/server/delivery/deliveryService";
import { MealType } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const serviceDate = url.searchParams.get("serviceDate") || new Date().toISOString().slice(0, 10);
    const mealType = (url.searchParams.get("mealType") as MealType | "ALL") || "ALL";

    const summary = getDeliveryDashboardSummary(user, serviceDate, mealType);

    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load delivery summary." },
      { status: 400 }
    );
  }
}
