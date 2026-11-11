import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { getClientIp } from "@/server/authentication/ip";
import { createBill, listBills } from "@/server/finance/billService";

export const dynamic = "force-dynamic";

/** Bills on record, newest first (?account=<key> for one account, ?q= to search, ?kind=RESIDENT|CUSTOMER). */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const p = request.nextUrl.searchParams;
    const result = await listBills(user, {
      accountKey: p.get("account") || undefined,
      q: p.get("q") || undefined,
      kind: (p.get("kind") as any) || undefined,
      type: (p.get("type") as any) || undefined,
      date: p.get("date") || undefined,
      limit: Number(p.get("limit")) || undefined,
      offset: Number(p.get("offset")) || undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/bills", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not load the bills.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}

/** Make a bill for everything an account owes now (Owner / Manager). */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const bill = await createBill(user, body, getClientIp(request));
    return NextResponse.json({ success: true, bill }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/finance/bills", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: friendlyError(error.message || "Could not make the bill.") }, { status: error?.statusCode === 409 ? 409 : 400 });
  }
}
