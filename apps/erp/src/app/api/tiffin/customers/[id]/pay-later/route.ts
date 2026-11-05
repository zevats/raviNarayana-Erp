import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { getPayLaterStatus, setPayLater } from "@/server/tiffin/payLaterService";

export const dynamic = "force-dynamic";

/** Pay Later approval of a customer, with the outstanding delivery balance (Owner / Manager). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, status: await getPayLaterStatus(user, params.id) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/customers/[id]/pay-later", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Failed to load Pay Later." }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const status = await setPayLater(user, params.id, body?.enabled, getClientIp(request));
    return NextResponse.json({ success: true, status });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/customers/[id]/pay-later", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Failed to change Pay Later." }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
