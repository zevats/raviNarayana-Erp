import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { pauseTiffinSubscription } from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
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
    const subscription = await pauseTiffinSubscription(user, params.id, body, clientIp);

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    if (error.message?.includes("not found")) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }

    const isClientValidation =
      error.message?.includes("Cannot pause") ||
      error.message?.includes("Valid pause start date") ||
      error.message?.includes("earlier than");

    return NextResponse.json(
      { success: false, error: error.message || "Failed to pause subscription." },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
