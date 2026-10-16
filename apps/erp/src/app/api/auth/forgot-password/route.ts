import { NextRequest, NextResponse } from "next/server";
import { initiatePasswordReset } from "@/server/authentication/auth";
import { validateCsrf, csrfForbiddenResponse } from "@/server/security/csrf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const csrf = validateCsrf(request);
  if (!csrf.valid) {
    return csrfForbiddenResponse(csrf.error);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { identifier } = body;

    const origin = request.headers.get("origin") || undefined;
    const result = await initiatePasswordReset(identifier || "", origin);

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error("Forgot password API error:", err);
    return NextResponse.json(
      {
        success: true,
        message: "If an account matching that identifier exists, a password reset link has been dispatched.",
      },
      { status: 200 }
    );
  }
}
