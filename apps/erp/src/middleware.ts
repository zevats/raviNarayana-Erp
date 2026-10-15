import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const ERP_COOKIE_NAME = "rn_erp_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get(ERP_COOKIE_NAME)?.value;
  const isAuthenticated = Boolean(sessionCookie && sessionCookie.length >= 32);

  // 1. Root route: allow app/page.tsx to perform database-backed validation
  if (pathname === "/") {
    return NextResponse.next();
  }

  // 2. Login route: allow page.tsx to render or redirect based on verified DB session
  if (pathname === "/login") {
    return NextResponse.next();
  }

  // 3. Protected management pages (e.g. /dashboard, /staff, /rooms, etc.)
  if (pathname.startsWith("/dashboard") || (!pathname.startsWith("/api") && !pathname.startsWith("/login"))) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // 4. Protected API endpoints
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/login") && !pathname.startsWith("/api/auth/logout")) {
    if (!isAuthenticated) {
      return NextResponse.json(
        { error: "Unauthorized access to Management ERP API." },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:jpg|jpeg|gif|png|svg|webp|ico)).*)",
  ],
};
