import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getTiffinCustomerBalance } from "@/server/tiffin/tiffinBillingService";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Customer ID is required." },
        { status: 400 }
      );
    }

    const balance = await getTiffinCustomerBalance(user, id);

    return NextResponse.json({ success: true, balance });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/customers/[id]/balance", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { success: false, error: error.message || "Failed to load customer balance." },
      { status: 400 }
    );
  }
}
