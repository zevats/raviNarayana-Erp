import type { NextRequest } from "next/server";

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^[a-fA-F0-9:]{2,39}$/;

export function isValidIp(ip: string): boolean {
  return IPV4_REGEX.test(ip) || IPV6_REGEX.test(ip);
}

/**
 * Resolve client IP address with explicit trust boundary.
 * 
 * In production when behind a verified reverse proxy (Nginx, Cloudflare, etc.),
 * TRUST_PROXY_HEADERS must be explicitly set to "true".
 * When false (default), forwarding headers are ignored to prevent spoofing.
 */
export function getClientIp(request: NextRequest): string {
  const trustProxy = process.env.TRUST_PROXY_HEADERS === "true";

  if (!trustProxy) {
    // Direct connection or untrusted proxy mode: ignore client-provided headers
    const directIp = (request as any).ip;
    if (directIp && isValidIp(directIp)) {
      return directIp;
    }
    return "127.0.0.1";
  }

  // 1. Cloudflare connecting IP (validated by Cloudflare edge)
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp && isValidIp(cfIp)) {
    return cfIp;
  }

  // 2. Standard X-Forwarded-For header
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    // In standard reverse proxy configurations, the client IP is the first entry
    const parts = xForwardedFor.split(",").map((p) => p.trim());
    const candidate = parts[0];
    if (candidate && isValidIp(candidate)) {
      return candidate;
    }
  }

  // 3. X-Real-IP header (common in Nginx setups)
  const xRealIp = request.headers.get("x-real-ip")?.trim();
  if (xRealIp && isValidIp(xRealIp)) {
    return xRealIp;
  }

  const directIp = (request as any).ip;
  if (directIp && isValidIp(directIp)) {
    return directIp;
  }

  return "127.0.0.1";
}
