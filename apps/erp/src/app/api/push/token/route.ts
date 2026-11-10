import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { savePushToken } from "@/server/notifications/pushService";

export const dynamic = "force-dynamic";

/** { token, platform }: links this phone's notification token to the signed-in staff member. */
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return unauthorizedResponse();
  try {
    const body = await request.json().catch(() => ({}));
    const result = await savePushToken(user, String(body.token || ""), String(body.platform || "android"));
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: friendlyError(error?.message || "Could not register this phone for alerts.") }, { status: 400 });
  }
}
