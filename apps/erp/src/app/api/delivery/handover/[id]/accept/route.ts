import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { acceptCashHandover } from "@/server/delivery/deliveryService";
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

    const handover = await acceptCashHandover(
      user,
      params.id,
      {
        acceptedCash: body.acceptedCash,
        acceptedUpi: body.acceptedUpi,
        varianceReason: body.varianceReason,
        notes: body.notes,
        expectedDriverId: body.expectedDriverId,
        expectedDeclaredCash: body.expectedDeclaredCash,
        expectedDeclaredUpi: body.expectedDeclaredUpi,
      },
      clientIp
    );

    return NextResponse.json({ success: true, handover });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/handover/[id]/accept", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to accept cash handover.") },
      { status: 400 }
    );
  }
}
