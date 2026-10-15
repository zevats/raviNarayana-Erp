import { NextRequest, NextResponse } from "next/server";
import { destroySession, ERP_COOKIE_NAME } from "@/server/authentication/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get(ERP_COOKIE_NAME)?.value;

    if (sessionToken) {
      destroySession(sessionToken);
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
