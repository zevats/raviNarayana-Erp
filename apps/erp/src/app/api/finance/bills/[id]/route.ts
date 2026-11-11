import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getBill } from "@/server/finance/billService";

export const dynamic = "force-dynamic";

/** One bill as it was issued (by id or bill number). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, bill: await getBill(user, decodeURIComponent(params.id)) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/bills/[id]", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not load the bill.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
