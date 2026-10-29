import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listRawMaterials,
  createRawMaterial,
  getLowStockAlerts,
} from "@/server/kitchen/kitchenInventoryService";
import { getClientIp } from "@/server/authentication/ip";
import { RawMaterialCategory } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const lowStockAlerts = url.searchParams.get("alerts") === "true";

    if (lowStockAlerts) {
      const alerts = await getLowStockAlerts(user);
      return NextResponse.json({ success: true, alerts });
    }

    const search = url.searchParams.get("search") || undefined;
    const category = (url.searchParams.get("category") as RawMaterialCategory) || undefined;
    const isActiveParam = url.searchParams.get("isActive");
    const isActive = isActiveParam !== null ? isActiveParam === "true" || isActiveParam === "1" : undefined;
    const lowStockOnly = url.searchParams.get("lowStockOnly") === "true";

    const materials = await listRawMaterials(user, {
      search,
      category,
      isActive,
      lowStockOnly,
    });

    return NextResponse.json({ success: true, materials });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: error.message || "Failed to list raw materials" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const clientIp = getClientIp(request);

    const material = await createRawMaterial(user, body, clientIp);
    return NextResponse.json({ success: true, material }, { status: 201 });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: error.message || "Failed to create raw material" }, { status: 400 });
  }
}
