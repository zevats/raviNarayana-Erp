import { NextRequest, NextResponse } from "next/server";
import {
  findStaffByIdentifier,
  verifyPassword,
  createSession,
  checkRateLimitAndRecord,
  recordLoginSuccess,
  DUMMY_PASSWORD_HASH,
  ERP_COOKIE_NAME,
} from "@/server/authentication/auth";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { identifier, password } = body;

    if (!identifier || typeof identifier !== "string" || !password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Username or email and password are required." },
        { status: 400 }
      );
    }

    const cleanIdentifier = identifier.trim().toLowerCase();
    const clientIp = getClientIp(request);

    // Layered rate-limiting check with atomic attempt reservation (prevents concurrency race conditions)
    const rateLimit = checkRateLimitAndRecord(cleanIdentifier, clientIp);
    if (rateLimit.isLimited) {
      return NextResponse.json(
        {
          error: rateLimit.reason || `Too many failed login attempts. Please try again in ${rateLimit.remainingMinutes} minutes.`,
        },
        { status: 429 }
      );
    }

    // Distributed abuse protection: progressive delay without account lockout
    if (rateLimit.shouldSlowDown) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const user = findStaffByIdentifier(cleanIdentifier);
    if (!user) {
      // Execute dummy password verification to maintain constant-time response and mitigate timing-based user enumeration
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return NextResponse.json(
        { error: "Invalid username or password. Please verify your credentials." },
        { status: 401 }
      );
    }

    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Invalid username or password. Please verify your credentials." },
        { status: 401 }
      );
    }

    // Successful authentication: records success and clears client failure counters
    recordLoginSuccess(cleanIdentifier, clientIp);

    const userAgent = request.headers.get("user-agent") || undefined;
    const { sessionToken, expiresAt } = createSession(user.id, {
      ip: clientIp,
      userAgent,
    });

    const isProduction = process.env.NODE_ENV === "production";
    const response = NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
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
  } catch (error) {
    console.error("ERP Login API Error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during authentication. Please try again." },
      { status: 500 }
    );
  }
}
