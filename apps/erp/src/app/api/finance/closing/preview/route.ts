import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { businessToday } from "@/lib/businessDate";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { previewDailyClosing } from "@/server/finance/cashbookClosingService";
import { ClosingDivision } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const closingDate = url.searchParams.get("closingDate") || businessToday();
    const division = (url.searchParams.get("division") as ClosingDivision) || "COMBINED";

    const preview = await previewDailyClosing(user, closingDate, division);
    return NextResponse.json({ success: true, preview });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to preview daily closing.") },
      { status: 400 }
    );
  }
}
