import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { validateCsrf, csrfForbiddenResponse } from "./server/security/csrf";
import { ERP_PATHNAME_HEADER } from "./server/authorization/sectionAccess";

export const ERP_COOKIE_NAME = "rn_erp_session";

// Redirect targets keep the origin the browser used (localhost, 127.0.0.1 or a LAN address).
// `request.url` can carry the dev server's own hostname instead, which drops the session cookie.
function sameOriginUrl(request: NextRequest, path: string): URL {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  return host ? new URL(path, `${proto}://${host}`) : new URL(path, request.url);
}

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
    pathname.startsWith("/brand/") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/bill/") ||
    pathname.startsWith("/receipt/") ||
    pathname === "/download" ||
    pathname.startsWith("/download/")
  ) {
    return NextResponse.next();
  }

  // 3. Protected management pages (e.g. /dashboard, /staff, /rooms, etc.)
  if (pathname.startsWith("/dashboard") || (!pathname.startsWith("/api") && !pathname.startsWith("/login"))) {
    if (!isAuthenticated) {
      const loginUrl = sameOriginUrl(request, "/login");
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    // Kitchen is out of scope and lives on only as a redirect to Orders.
    if (pathname === "/kitchen") {
      return NextResponse.redirect(sameOriginUrl(request, "/orders"));
    }
    // The management layout reads the path to send roles away from sections they cannot use
    // with a real redirect (before streaming starts). Always overwritten, so it cannot be spoofed.
    const headers = new Headers(request.headers);
    headers.set(ERP_PATHNAME_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
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
