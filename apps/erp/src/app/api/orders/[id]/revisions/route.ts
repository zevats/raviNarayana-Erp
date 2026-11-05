import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { listOrderRevisions } from "@/server/orders/orderLifecycleService";

export const dynamic = "force-dynamic";

/** Earlier versions of the order, newest first. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    return NextResponse.json({ success: true, revisions: await listOrderRevisions(user, params.id) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/orders/[id]/revisions", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Could not load the order history." }, { status: error.statusCode === 409 ? 409 : 400 });
  }
}
