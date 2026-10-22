import { NextRequest, NextResponse } from "next/server";
import {
  findStaffByIdentifier,
  verifyPassword,
  createOtpChallenge,
  verifyOtpChallenge,
  checkRateLimitAndRecord,
  recordLoginSuccess,
  DUMMY_PASSWORD_HASH,
  ERP_COOKIE_NAME,
} from "@/server/authentication/auth";
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
    const clientIp = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || undefined;

    // -------------------------------------------------------------------------
    // Branch 1: OTP Challenge Verification (Step 2)
    // -------------------------------------------------------------------------
    if (body.challengeId && body.otp) {
      try {
        const { user, sessionToken, expiresAt } = await verifyOtpChallenge(
          body.challengeId,
          body.otp,
          { ip: clientIp, userAgent }
        );

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
          { error: err.message || "Invalid or expired verification code." },
          { status: 401 }
        );
      }
    }

    // -------------------------------------------------------------------------
    // Branch 2: Primary Password Authentication (Step 1)
    // -------------------------------------------------------------------------
    const { identifier, password } = body;

    if (!identifier || typeof identifier !== "string" || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Username or email and password are required." },
        { status: 400 }
      );
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    // Layered rate-limiting check
    const tReqStart = Date.now();
    const tRateStart = Date.now();
    const rateLimit = await checkRateLimitAndRecord(cleanIdentifier, clientIp);
    const rateLimitMs = Date.now() - tRateStart;
    if (rateLimit.isLimited) {
      return NextResponse.json(
        {
          error:
            rateLimit.reason ||
            `Too many failed login attempts. Please try again in ${rateLimit.remainingMinutes} minutes.`,
        },
        { status: 429 }
      );
    }

    if (rateLimit.shouldSlowDown) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const tUserStart = Date.now();
    const user = await findStaffByIdentifier(cleanIdentifier);
    const findUserMs = Date.now() - tUserStart;
    if (!user) {
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return NextResponse.json(
        { error: "Invalid username or password. Please verify your credentials." },
        { status: 401 }
      );
    }

    const tBcryptStart = Date.now();
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    const bcryptMs = Date.now() - tBcryptStart;
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Invalid username or password. Please verify your credentials." },
        { status: 401 }
      );
    }

    // Run recordLoginSuccess concurrently with createOtpChallenge
    const tOtpStart = Date.now();
    const [, challenge] = await Promise.all([
      recordLoginSuccess(cleanIdentifier, clientIp),
      createOtpChallenge(user.id, user.email),
    ]);
    const otpFlowMs = Date.now() - tOtpStart;
    const totalLoginMs = Date.now() - tReqStart;

    console.log(
      `[ERP Login Request] total=${totalLoginMs}ms | rateLimit=${rateLimitMs}ms | findUser=${findUserMs}ms | bcrypt=${bcryptMs}ms | otpFlow=${otpFlowMs}ms`
    );

    return NextResponse.json(
      {
        success: true,
        status: "OTP_REQUIRED",
        challengeId: challenge.challengeId,
        emailMasked: challenge.maskedEmail,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("ERP Login API Error:", error);
    return NextResponse.json(
      { error: error?.message || "An unexpected error occurred during authentication." },
      { status: 500 }
    );
  }
}
