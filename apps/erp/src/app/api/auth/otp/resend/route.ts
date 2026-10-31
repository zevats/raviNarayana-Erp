import { NextRequest, NextResponse } from "next/server";
import { resendOtpChallenge } from "@/server/authentication/auth";
import { validateCsrf, csrfForbiddenResponse } from "@/server/security/csrf";
import { isDatabaseUnavailableError, databaseUnavailableResponse } from "@/server/database/availability";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrf = validateCsrf(request);
  if (!csrf.valid) {
    return csrfForbiddenResponse(csrf.error);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { challengeId } = body;

    if (!challengeId || typeof challengeId !== "string") {
      return NextResponse.json(
        { error: "Challenge ID is required to resend verification code." },
        { status: 400 }
      );
    }

    const { challengeId: newChallengeId, maskedEmail } = await resendOtpChallenge(challengeId);

    return NextResponse.json(
      {
        success: true,
        challengeId: newChallengeId,
        emailMasked: maskedEmail,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (isDatabaseUnavailableError(err)) {
      return databaseUnavailableResponse("ERP OTP Resend API", err);
    }
    const message = err?.message || "Failed to resend verification code.";
    const isRateLimited = message.toLowerCase().includes("please wait");
    return NextResponse.json(
      { error: message },
      { status: isRateLimited ? 429 : 400 }
    );
  }
}
