import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listResidentSettlements } from "@/server/residents/residentService";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const { id: residentId } = await context.params;
    if (!residentId) {
      return NextResponse.json({ error: "Resident ID is required." }, { status: 400 });
    }

    const settlements = await listResidentSettlements(user, residentId);

    return NextResponse.json({
      success: true,
      settlements,
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to fetch resident settlements.") },
      { status: 400 }
    );
  }
}
