import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { listSettlementProposals, approveSettlementProposal, closeSettlementProposal } from "@/server/residents/settlementApprovalService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

function errorResponse(error: any, fallback: string) {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse("/api/residents/settlement-proposals", error);
  if (dbError) return dbError;
  return NextResponse.json({ error: error.message || fallback }, { status: 400 });
}

/** Settlements waiting for the Owner (?status=PENDING|APPROVED|REJECTED|WITHDRAWN|ALL). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const raw = new URL(request.url).searchParams.get("status") || "PENDING";
    const status = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "ALL"].includes(raw) ? (raw as any) : "PENDING";
    return NextResponse.json({ success: true, proposals: await listSettlementProposals(user, status) });
  } catch (error: any) {
    return errorResponse(error, "Could not load the settlements waiting for approval.");
  }
}

/** { id, action: "approve" | "reject" | "withdraw", note? }. Approve and reject are Owner only. */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const ip = getClientIp(request);
    if (body.action === "approve") {
      const settlement = await approveSettlementProposal(user, String(body.id || ""), body.note, ip);
      return NextResponse.json({ success: true, settlement });
    }
    if (body.action === "reject" || body.action === "withdraw") {
      const proposal = await closeSettlementProposal(user, String(body.id || ""), body.action === "reject" ? "REJECTED" : "WITHDRAWN", body.note, ip);
      return NextResponse.json({ success: true, proposal });
    }
    return NextResponse.json({ error: "Choose approve, reject or withdraw." }, { status: 400 });
  } catch (error: any) {
    return errorResponse(error, "Could not update the settlement.");
  }
}
