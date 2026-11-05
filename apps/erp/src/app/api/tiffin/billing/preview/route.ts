import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { previewTiffinBilling } from "@/server/tiffin/tiffinBillingService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const billingPeriod = url.searchParams.get("billingPeriod")?.trim();
    const customerId = url.searchParams.get("customerId")?.trim() || undefined;

    if (!billingPeriod || !/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod)) {
      return NextResponse.json(
        { success: false, error: "billingPeriod is required and must be in YYYY-MM format (e.g. 2026-10)." },
        { status: 400 }
      );
    }

    const [year, month] = billingPeriod.split("-");
    const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    const startDate = `${billingPeriod}-01`;
    const endDate = `${billingPeriod}-${String(lastDay).padStart(2, "0")}`;

    const preview = await previewTiffinBilling(user, {
      billingPeriod,
      startDate,
      endDate,
      customerId,
    });

    return NextResponse.json({ success: true, preview });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/billing/preview", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { success: false, error: error.message || "Failed to calculate tiffin billing preview." },
      { status: 400 }
    );
  }
}
