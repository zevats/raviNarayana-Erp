import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { previewMonthlyRent, generateMonthlyRent } from "@/server/finance/rentGenerationService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

function errorResponse(error: any, fallback: string) {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse("/api/finance/rent-run", error);
  if (dbError) return dbError;
  return NextResponse.json({ error: friendlyError(error.message || fallback) }, { status: 400 });
}

/** Preview of the month's rent charges (?month=YYYY-MM, this month or last). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const month = new URL(request.url).searchParams.get("month") || undefined;
    return NextResponse.json({ success: true, ...(await previewMonthlyRent(user, month)) });
  } catch (error: any) {
    return errorResponse(error, "Could not prepare the rent preview.");
  }
}

/** Posts the month's rent charges: { month }. Safe to repeat (nothing is charged twice). */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ success: true, ...(await generateMonthlyRent(user, { month: body.month, trigger: "MANUAL" }, getClientIp(request))) });
  } catch (error: any) {
    return errorResponse(error, "Could not charge the month's rent.");
  }
}
