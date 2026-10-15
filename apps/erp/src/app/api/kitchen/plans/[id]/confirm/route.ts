import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { confirmMealPlan } from "@/server/kitchen/kitchenService";
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
    const plan = confirmMealPlan(user, params.id, clientIp);

    return NextResponse.json({ success: true, plan });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to confirm meal plan." },
      { status: 400 }
    );
  }
}
