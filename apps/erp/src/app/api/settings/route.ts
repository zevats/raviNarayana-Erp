import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getSettingsForAdmin, updateSettingsSection, SettingsSection } from "@/server/settings/settingsService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

const SECTIONS: readonly SettingsSection[] = ["business", "meals", "delivery", "finance", "notifications"];

function errorResponse(error: any, fallback: string) {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse("/api/settings", error);
  if (dbError) return dbError;
  return NextResponse.json({ error: friendlyError(error.message || fallback) }, { status: 400 });
}

/** All settings, who last changed each section, and the delivery staff to choose from. Owner only. */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, ...(await getSettingsForAdmin(user)) });
  } catch (error: any) {
    return errorResponse(error, "Could not load the settings.");
  }
}

/** Saves one section: { section, values }. Owner only. */
export async function PUT(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    if (!SECTIONS.includes(body?.section)) {
      return NextResponse.json({ error: "Unknown settings section." }, { status: 400 });
    }
    const settings = await updateSettingsSection(user, body.section, body.values, getClientIp(request));
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return errorResponse(error, "Could not save the settings.");
  }
}
