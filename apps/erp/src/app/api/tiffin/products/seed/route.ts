import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { planDefaultCatalogSeed, seedMissingDefaultCatalog } from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

function errorResponse(error: any, fallback: string) {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse("/api/tiffin/products/seed", error);
  if (dbError) return dbError;
  return NextResponse.json({ error: error.message || fallback }, { status: 400 });
}

/** Preview (dry run): which default menu items would be added; nothing is written. Owner only. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const plan = await planDefaultCatalogSeed(user);
    return NextResponse.json({ success: true, ...plan });
  } catch (error: any) {
    return errorResponse(error, "Could not preview the default menu.");
  }
}

/** Adds the missing default items. Requires { confirm: true } after a preview. Owner only. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return NextResponse.json({ error: "Preview the default menu first, then confirm." }, { status: 400 });
    }
    const result = await seedMissingDefaultCatalog(user, getClientIp(request));
    return NextResponse.json({
      success: true,
      ...result,
      inserted: result.added.length,
      message: result.added.length > 0 ? `Added ${result.added.length} default menu item(s). Existing items were not changed.` : "Every default item is already on the menu. Nothing was changed.",
    });
  } catch (error: any) {
    return errorResponse(error, "Could not add the default menu.");
  }
}
