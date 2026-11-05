import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { completeDeliveryTask } from "@/server/delivery/deliveryService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const clientIp = getClientIp(request);

    const task = await completeDeliveryTask(
      user,
      params.id,
      {
        recipientName: body.recipientName,
        notes: body.notes,
        collectedAmount: body.collectedAmount,
        paymentMethod: body.paymentMethod,
        paymentChoice: body.paymentChoice,
        payLaterAllowedAtSelection: typeof body.payLaterAllowedAtSelection === "boolean" ? body.payLaterAllowedAtSelection : undefined,
        idempotencyKey: body.idempotencyKey,
        deliveredQuantity: body.deliveredQuantity !== undefined ? Number(body.deliveredQuantity) : undefined,
        undeliveredQuantity: body.undeliveredQuantity !== undefined ? Number(body.undeliveredQuantity) : undefined,
        undeliveredReason: body.undeliveredReason,
        itemsReconciliation: body.itemsReconciliation,
        lines: Array.isArray(body.lines) ? body.lines : undefined,
      },
      clientIp
    );

    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/tasks/[id]/deliver", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: error.message || "Failed to complete delivery task." },
      { status: 400 }
    );
  }
}
