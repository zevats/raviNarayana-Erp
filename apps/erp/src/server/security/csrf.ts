import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const ERP_COOKIE_NAME = "rn_erp_session";

/**
 * Validates request origin against known host and configured application URLs.
 * Rejects cross-origin state-changing requests to defend against CSRF attacks.
 * 
 * Strict Security Rules:
 * 1. Safe HTTP methods (GET, HEAD, OPTIONS) are exempt.
 * 2. If 'Sec-Fetch-Site' is 'cross-site', the request is unconditionally rejected.
 * 3. If an Origin or Referer is present, it MUST match the request Host or allowed origins list.
 *    No public constant header (such as X-RN-CSRF) can independently authorize an untrusted origin.
 * 4. If Origin and Referer are absent:
 *    - If an ambient session cookie (rn_erp_session) is present, the request is rejected with HTTP 403.
 *    - If no session cookie is present (e.g. non-browser mobile API client), requests with
 *      verified client headers (x-rn-csrf, x-requested-with, or Authorization) are permitted.
 */
export function validateCsrf(req: NextRequest): { valid: boolean; error?: string } {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return { valid: true };
  }

  // 1. Unconditionally reject browsers reporting cross-site fetch
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite.toLowerCase() === "cross-site") {
    return {
      valid: false,
      error: "Cross-site request blocked by Sec-Fetch-Site policy (CSRF check failed)",
    };
  }

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const host = req.headers.get("host") || req.headers.get("x-forwarded-host");

  // Determine request source origin
  let requestOrigin = origin;
  if (!requestOrigin && referer) {
    try {
      const url = new URL(referer);
      requestOrigin = url.origin;
    } catch {
      // Invalid referer URL format
    }
  }

  // 2. If no origin or referer header is provided
  if (!requestOrigin) {
    const hasSessionCookie = Boolean(req.cookies.get(ERP_COOKIE_NAME)?.value);
    
    // Cookie-authenticated requests missing both origin and referer are untrusted
    if (hasSessionCookie) {
      return {
        valid: false,
        error: "Missing origin and referer headers on cookie-authenticated request (CSRF check failed)",
      };
    }

    // For non-browser / mobile-native clients without cookies
    const customHeader =
      req.headers.get("x-rn-csrf") ||
      req.headers.get("x-requested-with") ||
      req.headers.get("authorization");

    if (customHeader) {
      return { valid: true };
    }

    return {
      valid: false,
      error: "Missing origin or referer header on mutating request (CSRF check failed)",
    };
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(requestOrigin);
  } catch {
    return { valid: false, error: "Malformed origin header (CSRF check failed)" };
  }

  // 3. Same-host match
  if (host) {
    const hostWithoutPort = host.split(":")[0].toLowerCase();
    const originHostname = requestUrl.hostname.toLowerCase();
    if (hostWithoutPort === originHostname) {
      return { valid: true };
    }
  }

  // 4. Allowed origins list
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:3000",
    "http://localhost:3001",
    "https://erp.ravinarayan.in",
    "https://ravinarayan.in",
  ].filter(Boolean) as string[];

  const isAllowed = allowedOrigins.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      return allowedUrl.origin.toLowerCase() === requestOrigin!.toLowerCase();
    } catch {
      return false;
    }
  });

  if (isAllowed) {
    return { valid: true };
  }

  // 5. Hostile cross-origin: NEVER bypass, even if custom headers are passed
  return {
    valid: false,
    error: `Cross-origin request from '${requestOrigin}' rejected by CSRF policy`,
  };
}

export function csrfForbiddenResponse(error = "CSRF verification failed"): NextResponse {
  return NextResponse.json(
    {
      error,
      code: "CSRF_VIOLATION",
    },
    { status: 403 }
  );
}
