import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { getSettings } from "@/server/settings/settingsService";

export const dynamic = "force-dynamic";

/** Business contact details for printed invoices (any signed-in management user; nothing secret). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    if (user.role === "DELIVERY_PERSON") return NextResponse.json({ error: "Not available." }, { status: 403 });
    const { business } = await getSettings();
    return NextResponse.json({ success: true, business });
  } catch (error: any) {
    const dbError = databaseErrorResponse("/api/settings/business", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: "Could not load the business details." }, { status: 400 });
  }
}
