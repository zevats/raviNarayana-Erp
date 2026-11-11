import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  createUnifiedOrder,
  listUnifiedOrders,
} from "@/server/orders/orderService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const searchParams = request.nextUrl.searchParams;
    const serviceDate = searchParams.get("serviceDate") || undefined;
    const orderType = (searchParams.get("orderType") as any) || "ALL";
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    const result = await listUnifiedOrders(user, {
      serviceDate,
      orderType,
      status,
      search,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to load orders.") },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const order = await createUnifiedOrder(
      user,
      {
        orderType: body.orderType,
        customerId: body.customerId,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        deliveryAddress: body.deliveryAddress,
        serviceDate: body.serviceDate,
        mealType: body.mealType,
        items: body.items,
        paymentMethod: body.paymentMethod,
        paymentStatus: body.paymentStatus,
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
        // A monthly-plan customer's order: the plan's thali for the meal is free.
        subscriptionId: typeof body.subscriptionId === "string" ? body.subscriptionId : undefined,
        assignToStaffId: typeof body.assignToStaffId === "string" && body.assignToStaffId ? body.assignToStaffId : undefined,
      },
      clientIp
    );

    return NextResponse.json({ success: true, order }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to create order.") },
      { status: 400 }
    );
  }
}
