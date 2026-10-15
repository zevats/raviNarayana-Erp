import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getMealPlanById,
  updateMealPlan,
} from "@/server/kitchen/kitchenService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const planDetail = getMealPlanById(user, params.id);
    if (!planDetail) {
      return NextResponse.json({ error: "Meal plan not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...planDetail });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load meal plan." },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const updatedPlan = updateMealPlan(
      user,
      params.id,
      {
        guestCount: body.guestCount,
        notes: body.notes,
        residentOptOuts: body.residentOptOuts,
      },
      clientIp
    );

    return NextResponse.json({ success: true, plan: updatedPlan });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to update meal plan." },
      { status: 400 }
    );
  }
}
