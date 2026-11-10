import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { recordWalkInSale, listWalkInSales } from "@/server/kitchen/kitchenService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const serviceDate = url.searchParams.get("serviceDate") || new Date().toISOString().slice(0, 10);

    const result = await listWalkInSales(user, serviceDate);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to load walk-in sales.") },
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

    const result = await recordWalkInSale(
      user,
      {
        serviceDate: body.serviceDate,
        mealType: body.mealType,
        productId: body.productId,
        productName: body.productName,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        paymentMethod: body.paymentMethod,
        buyerName: body.buyerName,
        buyerPhone: body.buyerPhone,
        notes: body.notes,
        idempotencyKey: body.idempotencyKey,
      },
      clientIp
    );

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to record walk-in sale.") },
      { status: 400 }
    );
  }
}
