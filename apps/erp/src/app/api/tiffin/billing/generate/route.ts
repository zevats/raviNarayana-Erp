import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";

export const dynamic = "force-dynamic";

/**
 * Plan bills are no longer made by hand (owner, 2026-11-11): each plan month is added to the
 * customer's dues by itself on the day it starts (server/tiffin/planCharges.ts). Making them here
 * as well could charge a month twice, so this is closed. Bills are made from Dues.
 */
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return unauthorizedResponse();
  return NextResponse.json({ success: false, error: "Monthly plans are added to dues automatically. Make bills from Dues." }, { status: 410 });
}
