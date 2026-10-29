import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listInvoices,
  createInvoice,
} from "@/server/finance/invoiceService";
import { getClientIp } from "@/server/authentication/ip";
import { InvoiceCategory, InvoiceStatus, InvoiceType } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const residentId = url.searchParams.get("residentId") || undefined;
    const customerId = url.searchParams.get("customerId") || undefined;
    const invoiceCategory = (url.searchParams.get("invoiceCategory") as InvoiceCategory) || undefined;
    const status = (url.searchParams.get("status") as InvoiceStatus) || undefined;
    const invoiceType = (url.searchParams.get("invoiceType") as InvoiceType) || undefined;
    const billingPeriod = url.searchParams.get("billingPeriod") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

    const result = await listInvoices(user, {
      residentId,
      customerId,
      invoiceCategory,
      status,
      invoiceType,
      billingPeriod,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load invoices." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const clientIp = getClientIp(request);

    const invoice = await createInvoice(user, body, clientIp);

    return NextResponse.json({ success: true, invoice }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to create invoice." },
      { status: 400 }
    );
  }
}
