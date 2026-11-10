import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { resumeTiffinSubscription } from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const subscription = await resumeTiffinSubscription(user, params.id, clientIp);

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    if (error.message?.includes("not found")) {
      return NextResponse.json({ success: false, error: friendlyError(error.message) }, { status: 404 });
    }

    const isClientValidation = error.message?.includes("Cannot resume");

    return NextResponse.json(
      { success: false, error: friendlyError(error.message || "Failed to resume subscription.") },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
