import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getUnallocatedPaymentsForResident } from "@/server/finance/invoiceService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const residentId = url.searchParams.get("residentId");
    const customerId = url.searchParams.get("customerId");

    if (!residentId && !customerId) {
      return NextResponse.json(
        { error: "Resident ID or Customer ID is required." },
        { status: 400 }
      );
    }

    let payments;
    if (customerId) {
      const { getUnallocatedPaymentsForCustomer } = await import("@/server/tiffin/tiffinBillingService");
      payments = await getUnallocatedPaymentsForCustomer(user, customerId);
    } else {
      payments = await getUnallocatedPaymentsForResident(user, residentId!);
    }

    return NextResponse.json({ success: true, payments });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load unallocated payments." },
      { status: 400 }
    );
  }
}
