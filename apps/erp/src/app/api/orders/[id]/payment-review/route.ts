import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { closePaymentReview } from "@/server/tiffin/payLaterService";

export const dynamic = "force-dynamic";

/** Close the review of an order delivered with a balance left without Pay Later approval. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    await closePaymentReview(user, params.id, String(body?.note || ""), getClientIp(request));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders/[id]/payment-review", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to close the review.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
