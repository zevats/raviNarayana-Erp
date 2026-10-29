import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { seedDefaultCatalogIfEmpty } from "@/server/tiffin/tiffinService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const inserted = await seedDefaultCatalogIfEmpty(user);

    return NextResponse.json({ success: true, inserted });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to seed default catalog." },
      { status: 400 }
    );
  }
}
