import { NextRequest, NextResponse } from "next/server";
import { completePasswordReset } from "@/server/authentication/auth";
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
    const { token, newPassword } = body;

    if (!token || typeof token !== "string" || !newPassword || typeof newPassword !== "string") {
      return NextResponse.json(
        { error: "Token and new password are required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const result = await completePasswordReset(token, newPassword, clientIp);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Unable to reset password. Token may be invalid or expired." },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Password reset successfully. You can now log in with your new password.",
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Reset password API error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred during password reset." },
      { status: 500 }
    );
  }
}
