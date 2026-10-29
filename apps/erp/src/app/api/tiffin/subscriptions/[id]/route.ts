import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getTiffinSubscriptionById,
  updateTiffinSubscription,
} from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const subscription = await getTiffinSubscriptionById(user, params.id);
    if (!subscription) {
      return NextResponse.json(
        { success: false, error: `Subscription '${params.id}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve subscription." },
      { status: error.statusCode || 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request payload." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const subscription = await updateTiffinSubscription(user, params.id, body, clientIp);

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    if (error.message?.includes("not found")) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }

    const isClientValidation =
      error.message?.includes("Cannot update") ||
      error.message?.includes("earlier than") ||
      error.message?.includes("Invalid") ||
      error.message?.includes("characters long");

    return NextResponse.json(
      { success: false, error: error.message || "Failed to update subscription." },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
