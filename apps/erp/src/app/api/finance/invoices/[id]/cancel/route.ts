import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { cancelInvoice } from "@/server/finance/invoiceService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const reason = body?.reason;

    if (!reason || typeof reason !== "string") {
      return NextResponse.json(
        { error: "Cancellation reason is required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const invoice = await cancelInvoice(user, params.id, reason, clientIp);

    return NextResponse.json({ success: true, invoice });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to cancel invoice.") },
      { status: 400 }
    );
  }
}
