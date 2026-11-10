import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getCustomerMonthlyActivity } from "@/server/orders/orderService";

export const dynamic = "force-dynamic";

/** A customer's orders and monthly bills for this month and the two before, with paid and due. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const { id } = await params;
    if (!id) return NextResponse.json({ success: false, error: "Choose a customer." }, { status: 400 });
    const months = Math.max(1, Math.min(12, Number(request.nextUrl.searchParams.get("months")) || 3));
    const activity = await getCustomerMonthlyActivity(user, id, months);
    return NextResponse.json({ success: true, months: activity });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/customers/[id]/orders", error);
    if (dbError) return dbError;
    return NextResponse.json({ success: false, error: friendlyError(error.message || "Could not load the orders.") }, { status: 400 });
  }
}
