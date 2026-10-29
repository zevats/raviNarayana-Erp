import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { recordTiffinPayment } from "@/server/tiffin/tiffinBillingService";
import { getClientIp } from "@/server/authentication/ip";
import { RecordTiffinPaymentInput } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json()) as RecordTiffinPaymentInput;

    if (!body || !body.customerId) {
      return NextResponse.json(
        { success: false, error: "customerId is required." },
        { status: 400 }
      );
    }

    if (!body.amount || typeof body.amount !== "number" || body.amount <= 0) {
      return NextResponse.json(
        { success: false, error: "amount must be a positive number greater than 0." },
        { status: 400 }
      );
    }

    const txDate = body.transactionDate || (body as any).paymentDate;
    if (!txDate || !/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
      return NextResponse.json(
        { success: false, error: "transactionDate is required in YYYY-MM-DD format." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const result = await recordTiffinPayment(
      user,
      {
        ...body,
        transactionDate: txDate,
      },
      clientIp
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { success: false, error: error.message || "Failed to record tiffin payment." },
      { status: 400 }
    );
  }
}
