import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateCsrf, csrfForbiddenResponse } from "./server/security/csrf";

export const ERP_COOKIE_NAME = "rn_erp_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  // 1. CSRF Protection for all state-changing API endpoints
  if (pathname.startsWith("/api/") && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = validateCsrf(request);
    if (!csrf.valid) {
      return csrfForbiddenResponse(csrf.error);
    }
  }

  const sessionCookie = request.cookies.get(ERP_COOKIE_NAME)?.value;
  const isAuthenticated = Boolean(sessionCookie && sessionCookie.length >= 32);

  // 2. Public PWA assets, offline fallback, and unauthenticated recovery routes
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname === "/offline" ||
    pathname === "/favicon.ico" ||
    pathname === "/logo.png" ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password")
  ) {
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

  // 5. Protected API endpoints (except public auth endpoints and health check)
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/login") &&
    !pathname.startsWith("/api/auth/logout") &&
    !pathname.startsWith("/api/auth/forgot-password") &&
    !pathname.startsWith("/api/auth/reset-password") &&
    !pathname.startsWith("/api/auth/otp/") &&
    !pathname.startsWith("/api/health")
  ) {
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
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|manifest.json|sw.js|.*\\.(?:jpg|jpeg|gif|png|svg|webp|ico)).*)",
  ],
};
