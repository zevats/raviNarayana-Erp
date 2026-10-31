import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { setTiffinProductStatus } from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";
import { ProductStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const status = body?.status as ProductStatus;

    if (!status || !["ACTIVE", "INACTIVE"].includes(status)) {
      return NextResponse.json(
        { error: "Valid status ('ACTIVE' or 'INACTIVE') is required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const product = await setTiffinProductStatus(user, params.id, status, clientIp);

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/products/[id]/status", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to update product status." },
      { status: 400 }
    );
  }
}
