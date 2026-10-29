import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listDailyClosings,
  saveDailyClosingDraft,
  finalizeDailyClosing,
} from "@/server/finance/cashbookClosingService";
import { getClientIp } from "@/server/authentication/ip";
import { ClosingDivision, ClosingStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const division = (url.searchParams.get("division") as ClosingDivision) || undefined;
    const status = (url.searchParams.get("status") as ClosingStatus) || undefined;
    const hasDiscrepancy = url.searchParams.get("hasDiscrepancy") === "true";

    const closings = await listDailyClosings(user, {
      startDate,
      endDate,
      division,
      status,
      hasDiscrepancy: hasDiscrepancy || undefined,
    });

    return NextResponse.json({ success: true, closings });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to list daily closings." },
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
    const action = body.action || "finalize";

    let closing;
    if (action === "draft") {
      closing = await saveDailyClosingDraft(user, body, clientIp);
    } else if (action === "finalize") {
      closing = await finalizeDailyClosing(user, body, clientIp);
    } else {
      return NextResponse.json(
        { error: `Unknown closing action '${action}'. Expected 'draft' or 'finalize'.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, closing }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to process daily closing." },
      { status: 400 }
    );
  }
}
