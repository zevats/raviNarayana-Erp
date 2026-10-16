import { NextRequest, NextResponse } from "next/server";
import { verifyOtpChallenge, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { getClientIp } from "@/server/authentication/ip";
import { validateCsrf, csrfForbiddenResponse } from "@/server/security/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrf = validateCsrf(request);
  if (!csrf.valid) {
    return csrfForbiddenResponse(csrf.error);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { challengeId, otp } = body;

    if (!challengeId || typeof challengeId !== "string" || !otp || typeof otp !== "string") {
      return NextResponse.json(
        { error: "Challenge ID and 6-digit verification code are required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || undefined;

    const { user, sessionToken, expiresAt } = await verifyOtpChallenge(challengeId, otp, {
      ip: clientIp,
      userAgent,
    });

    const isProduction = process.env.NODE_ENV === "production";
    const response = NextResponse.json(
      {
        success: true,
        user,
      },
      { status: 200 }
    );

    response.cookies.set({
      name: ERP_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Invalid or expired verification code." },
      { status: 401 }
    );
  }
}
