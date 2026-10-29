import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listStockMovements } from "@/server/kitchen/kitchenInventoryService";
import { StockMovementType, StockSourceType } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const materialId = url.searchParams.get("materialId") || undefined;
    const movementType = (url.searchParams.get("movementType") as StockMovementType) || undefined;
    const sourceType = (url.searchParams.get("sourceType") as StockSourceType) || undefined;
    const sourceId = url.searchParams.get("sourceId") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;

    const movements = await listStockMovements(user, {
      materialId,
      movementType,
      sourceType,
      sourceId,
      limit,
    });

    return NextResponse.json({ success: true, movements });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: error.message || "Failed to list stock movements" }, { status: 400 });
  }
}
