import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getOrCreateReceipt } from "@/server/finance/receiptService";

export const dynamic = "force-dynamic";

/** The receipt of one payment (made the first time it is opened, kept on record). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, receipt: await getOrCreateReceipt(user, decodeURIComponent(params.id)) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/receipts/[id]", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not load the receipt.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
