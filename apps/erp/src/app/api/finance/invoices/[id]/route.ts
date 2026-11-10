import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getInvoiceById } from "@/server/finance/invoiceService";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const invoice = await getInvoiceById(user, params.id);
    if (!invoice) {
      return NextResponse.json(
        { error: `Invoice '${params.id}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, invoice });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to load invoice.") },
      { status: 400 }
    );
  }
}
