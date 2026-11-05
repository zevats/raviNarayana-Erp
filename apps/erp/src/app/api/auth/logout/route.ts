import { NextRequest, NextResponse } from "next/server";
import { destroySession, validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { recordAuditEventAsync } from "@/server/audit/audit";
import { getClientIp } from "@/server/authentication/ip";
import { validateCsrf, csrfForbiddenResponse } from "@/server/security/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrf = validateCsrf(request);
  if (!csrf.valid) {
    return csrfForbiddenResponse(csrf.error);
  }

  try {
    const sessionToken = request.cookies.get(ERP_COOKIE_NAME)?.value;

    if (sessionToken) {
      // Activity log entry for the sign-out; it never delays or blocks signing out.
      const user = await validateSession(sessionToken).catch(() => null);
      await destroySession(sessionToken);
      if (user) {
        await recordAuditEventAsync({
          actorId: user.id, actorUsername: user.username, action: "auth.signed_out", targetType: "staff", targetId: user.id, metadata: {}, ipAddress: getClientIp(request),
        }).catch(() => {});
      }
    }

    const response = NextResponse.json({ success: true, message: "Logged out successfully" });

    response.cookies.set({
      name: ERP_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("ERP Logout API Error:", error);
    return NextResponse.json(
      { error: "Failed to log out. Please try again." },
      { status: 500 }
    );
  }
}
