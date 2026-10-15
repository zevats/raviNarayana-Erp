import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { adjustMealPlanQuantity } from "@/server/kitchen/kitchenService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const plan = adjustMealPlanQuantity(
      user,
      params.id,
      {
        newResidentCount: body.newResidentCount,
        newGuestCount: body.newGuestCount,
        reason: body.reason,
      },
      clientIp
    );

    return NextResponse.json({ success: true, plan });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to adjust meal plan quantity." },
      { status: 400 }
    );
  }
}
