import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { issueInvoice } from "@/server/finance/invoiceService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Body is optional
    }

    const clientIp = getClientIp(request);
    const invoice = await issueInvoice(user, params.id, body, clientIp);

    return NextResponse.json({ success: true, invoice });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to issue invoice." },
      { status: 400 }
    );
  }
}
