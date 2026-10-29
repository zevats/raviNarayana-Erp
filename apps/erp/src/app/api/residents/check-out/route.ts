import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  checkOutResident,
  finalizeResidentCheckoutSettlement,
} from "@/server/residents/residentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    // If settlement details are provided, execute full atomic checkout & settlement
    if (
      body.finalizeSettlement === true ||
      Array.isArray(body.deductions) ||
      body.depositAppliedAmount !== undefined ||
      body.refundAmount !== undefined ||
      body.remainingPayableAmount !== undefined
    ) {
      const settlement = await finalizeResidentCheckoutSettlement(
        user,
        {
          residentId: body.residentId,
          checkOutDate: body.checkOutDate,
          deductions: body.deductions,
          depositAppliedAmount: body.depositAppliedAmount,
          refundAmount: body.refundAmount,
          refundPaymentMethod: body.refundPaymentMethod,
          refundReference: body.refundReference,
          remainingPayableAmount: body.remainingPayableAmount,
          paymentMethod: body.paymentMethod,
          paymentReference: body.paymentReference,
          notes: body.notes,
        },
        clientIp
      );

      return NextResponse.json({
        success: true,
        message: "Resident checkout and final financial settlement successfully completed.",
        settlement,
      });
    }

    // Default basic checkout flow
    await checkOutResident(
      user,
      {
        residentId: body.residentId,
        checkOutDate: body.checkOutDate,
      },
      clientIp
    );

    return NextResponse.json({ success: true, message: "Resident successfully checked out." });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json({ error: error.message || "Failed to check out resident." }, { status: 400 });
  }
}

