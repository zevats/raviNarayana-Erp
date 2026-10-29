import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { allocatePaymentToInvoice } from "@/server/finance/invoiceService";
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
    const paymentTransactionId = body?.paymentTransactionId;

    if (!paymentTransactionId) {
      return NextResponse.json(
        { error: "Payment transaction ID is required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const result = await allocatePaymentToInvoice(
      user,
      {
        invoiceId: params.id,
        paymentTransactionId,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        notes: body.notes,
      },
      clientIp
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to allocate payment to invoice." },
      { status: 400 }
    );
  }
}
