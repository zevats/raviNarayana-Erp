import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listTransactions,
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  reverseTransaction,
} from "@/server/finance/financeService";
import { getClientIp } from "@/server/authentication/ip";
import { TransactionType } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const type = (url.searchParams.get("type") as TransactionType) || undefined;
    const category = url.searchParams.get("category") || undefined;
    const residentId = url.searchParams.get("residentId") || undefined;
    const stayId = url.searchParams.get("stayId") || undefined;
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

    const transactions = listTransactions(user, {
      type,
      category,
      residentId,
      stayId,
      startDate,
      endDate,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, transactions });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load financial transactions." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);
    const action = body.action || body.transactionType;

    let transaction;

    switch (action) {
      case "RENT_CHARGE":
        transaction = recordRentCharge(user, body, clientIp);
        break;

      case "RENT_PAYMENT":
        transaction = recordRentPayment(user, body, clientIp);
        break;

      case "SECURITY_DEPOSIT":
        transaction = recordSecurityDeposit(user, body, clientIp);
        break;

      case "EXPENSE":
        transaction = recordExpense(user, body, clientIp);
        break;

      case "REVERSAL":
        transaction = reverseTransaction(user, body.transactionId, body.reason, clientIp);
        break;

      default:
        return NextResponse.json(
          { error: `Unknown financial action '${action}'. Must be RENT_CHARGE, RENT_PAYMENT, SECURITY_DEPOSIT, EXPENSE, or REVERSAL.` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, transaction }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to record financial transaction." },
      { status: 400 }
    );
  }
}
