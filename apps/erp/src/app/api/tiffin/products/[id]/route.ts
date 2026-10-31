import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getTiffinProductById,
  updateTiffinProduct,
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

    const product = await getTiffinProductById(user, params.id);
    if (!product) {
      return NextResponse.json(
        { error: `Product '${params.id}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/products/[id]", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to load product." },
      { status: 400 }
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

    const body = await request.json();
    const clientIp = getClientIp(request);

    const product = await updateTiffinProduct(user, params.id, body, clientIp);

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/products/[id]", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to update product." },
      { status: 400 }
    );
  }
}
