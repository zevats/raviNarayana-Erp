import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getDailyClosingById } from "@/server/finance/cashbookClosingService";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const closingId = params.id;
    const closing = await getDailyClosingById(user, closingId);

    if (!closing) {
      return NextResponse.json(
        { error: `Daily closing '${closingId}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, closing });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to get daily closing." },
      { status: 400 }
    );
  }
}
