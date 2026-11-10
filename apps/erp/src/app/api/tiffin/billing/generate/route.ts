import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { businessToday, addBusinessDays } from "@/lib/businessDate";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { generateTiffinInvoices } from "@/server/tiffin/tiffinBillingService";
import { getClientIp } from "@/server/authentication/ip";
import { GenerateTiffinInvoicesInput } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json()) as GenerateTiffinInvoicesInput;

    if (!body || !body.billingPeriod || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.billingPeriod)) {
      return NextResponse.json(
        { success: false, error: "billingPeriod is required and must be in YYYY-MM format (e.g. 2026-10)." },
        { status: 400 }
      );
    }

    const [year, month] = body.billingPeriod.split("-");
    const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    const defaultStart = `${body.billingPeriod}-01`;
    const defaultEnd = `${body.billingPeriod}-${String(lastDay).padStart(2, "0")}`;

    const paymentTerms = (body as any).paymentTermsDays ?? 15;
    const defaultDue = addBusinessDays(businessToday(), Number(paymentTerms) || 0);

    const input: GenerateTiffinInvoicesInput = {
      billingPeriod: body.billingPeriod,
      startDate: body.startDate || defaultStart,
      endDate: body.endDate || defaultEnd,
      dueDate: body.dueDate || defaultDue,
      autoIssue: body.autoIssue ?? (body as any).issueImmediately ?? true,
      invoiceType: body.invoiceType || "REGULAR_BILL",
      customerIds: body.customerIds,
      notes: body.notes,
    };

    const clientIp = getClientIp(request);
    const result = await generateTiffinInvoices(user, input, clientIp);

    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/billing/generate", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { success: false, error: friendlyError(error.message || "Failed to generate tiffin invoices.") },
      { status: 400 }
    );
  }
}
