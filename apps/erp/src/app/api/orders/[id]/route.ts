import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { updateDeliveryOrder } from "@/server/orders/orderLifecycleService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Edits a delivery order that has not gone out: { items?, deliveryAddress?, notes?, reason?, overrideCutoff? }. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const result = await updateDeliveryOrder(
      user,
      params.id,
      {
        items: Array.isArray(body.items) ? body.items.map((i: any) => ({ productId: String(i.productId || ""), quantity: Number(i.quantity) })) : undefined,
        deliveryAddress: typeof body.deliveryAddress === "string" ? body.deliveryAddress : undefined,
        notes: body.notes === undefined ? undefined : body.notes,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        overrideCutoff: body.overrideCutoff === true,
      },
      getClientIp(request)
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders/[id]", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Could not change the order." }, { status: error.statusCode === 409 ? 409 : 400 });
  }
}
