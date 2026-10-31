import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { removePushToken } from "@/server/notifications/pushService";

export const dynamic = "force-dynamic";

/** { token }: this phone stops getting the signed-in person's alerts (called on sign-out). */
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  await removePushToken(user, String(body.token || ""));
  return NextResponse.json({ success: true });
}
