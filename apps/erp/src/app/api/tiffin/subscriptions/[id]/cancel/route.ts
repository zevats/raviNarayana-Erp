import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { cancelTiffinSubscription } from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is acceptable for cancellation
      body = {};
    }

    const clientIp = getClientIp(request);
    const subscription = await cancelTiffinSubscription(user, params.id, body, clientIp);

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    if (error.message?.includes("not found")) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }

    const isClientValidation = error.message?.includes("Cannot cancel");

    return NextResponse.json(
      { success: false, error: error.message || "Failed to cancel subscription." },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
