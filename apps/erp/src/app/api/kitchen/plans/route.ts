import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listMealPlans,
  createMealPlan,
  getKitchenDashboardSummary,
} from "@/server/kitchen/kitchenService";
import { getClientIp } from "@/server/authentication/ip";
import { MealType, MealPlanStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const summary = url.searchParams.get("summary");
    const serviceDate = url.searchParams.get("serviceDate");

    if (summary === "true") {
      const dashboard = getKitchenDashboardSummary(user, serviceDate || undefined);
      return NextResponse.json({ success: true, dashboard });
    }

    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const mealType = (url.searchParams.get("mealType") as MealType) || undefined;
    const status = (url.searchParams.get("status") as MealPlanStatus) || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

    const plans = listMealPlans(user, {
      startDate,
      endDate,
      mealType,
      status,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, plans });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load meal plans." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const plan = createMealPlan(
      user,
      {
        serviceDate: body.serviceDate,
        mealType: body.mealType,
        guestCount: body.guestCount,
        notes: body.notes,
        residentOptOuts: body.residentOptOuts,
        status: body.status,
      },
      clientIp
    );

    return NextResponse.json({ success: true, plan }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to create meal plan." },
      { status: 400 }
    );
  }
}
