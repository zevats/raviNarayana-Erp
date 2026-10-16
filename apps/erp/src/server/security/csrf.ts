import { NextRequest, NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Validates request origin against known host and configured application URLs.
 * Rejects cross-origin state-changing requests to defend against CSRF attacks.
 */
export function validateCsrf(req: NextRequest): { valid: boolean; error?: string } {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) {
    return { valid: true };
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

  // If no origin or referer header is provided on a mutating cookie-authenticated request
  if (!requestOrigin) {
    // If a custom Anti-CSRF token or header is provided by trusted client code
    const customHeader = req.headers.get("x-rn-csrf") || req.headers.get("x-requested-with");
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

  // 1. Same-host match
  if (host) {
    const hostWithoutPort = host.split(":")[0].toLowerCase();
    const originHostname = requestUrl.hostname.toLowerCase();
    if (hostWithoutPort === originHostname) {
      return { valid: true };
    }
  }

  // 2. Allowed origins list
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
