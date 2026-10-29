import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getRawMaterialById,
  updateRawMaterial,
} from "@/server/kitchen/kitchenInventoryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const material = await getRawMaterialById(user, params.id);
    if (!material) {
      return NextResponse.json({ error: "Raw material not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, material });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: error.message || "Failed to fetch raw material" }, { status: 400 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const clientIp = getClientIp(request);

    const material = await updateRawMaterial(user, params.id, body, clientIp);
    return NextResponse.json({ success: true, material });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: error.message || "Failed to update raw material" }, { status: 400 });
  }
}
