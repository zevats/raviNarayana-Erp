import { NextRequest, NextResponse } from "next/server";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sessionToken = request.cookies.get(ERP_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = validateSession(sessionToken);

    if (!user) {
      const response = NextResponse.json({ error: "Session expired or invalid" }, { status: 401 });
      response.cookies.set({
        name: ERP_COOKIE_NAME,
        value: "",
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("ERP Auth Me API Error:", error);
    return NextResponse.json({ error: "Server error checking session" }, { status: 500 });
  }
}
