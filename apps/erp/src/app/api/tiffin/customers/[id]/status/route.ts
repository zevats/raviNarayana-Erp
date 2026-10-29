import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { setTiffinCustomerStatus } from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";
import { CustomerStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const status = body?.status as CustomerStatus;

    if (!status || !["ACTIVE", "INACTIVE"].includes(status)) {
      return NextResponse.json(
        { error: "Valid status ('ACTIVE' or 'INACTIVE') is required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const customer = await setTiffinCustomerStatus(user, params.id, status, clientIp);

    return NextResponse.json({ success: true, customer });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to update customer status." },
      { status: 400 }
    );
  }
}
