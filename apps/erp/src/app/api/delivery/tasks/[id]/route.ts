import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getDeliveryTaskById } from "@/server/delivery/deliveryService";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const detail = await getDeliveryTaskById(user, params.id);
    if (!detail) {
      return NextResponse.json({ error: "Delivery task not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, ...detail });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load delivery task." },
      { status: 400 }
    );
  }
}
