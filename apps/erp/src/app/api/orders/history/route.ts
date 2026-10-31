import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getCustomerOrderHistory } from "@/server/orders/orderService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const searchParams = request.nextUrl.searchParams;
    const customerId = searchParams.get("customerId") || undefined;
    const phone = searchParams.get("phone") || undefined;

    const history = await getCustomerOrderHistory(user, { customerId, phone });

    return NextResponse.json({ success: true, history });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders/history", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to retrieve customer order history." },
      { status: 400 }
    );
  }
}
