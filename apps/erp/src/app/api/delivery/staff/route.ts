import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listActiveDeliveryStaff } from "@/server/delivery/deliveryService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const staff = listActiveDeliveryStaff(user);

    return NextResponse.json({ success: true, staff });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load delivery staff." },
      { status: 400 }
    );
  }
}
