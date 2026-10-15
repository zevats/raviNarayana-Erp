import { NextRequest, NextResponse } from "next/server";
import { validateSession, ERP_COOKIE_NAME } from "../authentication/auth";
import { hasPermission } from "./permissions";
import { recordAuditEvent } from "../audit/audit";
import { AuthenticatedUser, Permission } from "@/types";

export class AuthorizationError extends Error {
  public readonly statusCode: 401 | 403;
  public readonly code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(statusCode: 401 | 403, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.statusCode = statusCode;
    this.code = statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN";
  }
}

/**
 * Resolves the authenticated user from the HTTP request session cookie.
 * Inactive accounts automatically fail session validation and return null.
 */
export function resolveUserFromRequest(request: NextRequest): AuthenticatedUser | null {
  const sessionToken = request.cookies.get(ERP_COOKIE_NAME)?.value;
  if (!sessionToken || sessionToken.length < 32) {
    return null;
  }

  return validateSession(sessionToken);
}

/**
 * Asserts that the request carries a valid, active session.
 * Throws an AuthorizationError(401) if unauthenticated or inactive.
 */
export function requireUser(request: NextRequest): AuthenticatedUser {
  const user = resolveUserFromRequest(request);
  if (!user) {
    throw new AuthorizationError(401, "Authentication required. Please sign in.");
  }
  return user;
}

/**
 * Asserts that the authenticated user possesses the required permission.
 * Fails closed. If permission is missing, logs an authorization failure audit event
 * and throws an AuthorizationError(403).
 */
export function requirePermission(
  user: AuthenticatedUser | null | undefined,
  permission: Permission,
  context?: { ip?: string; targetId?: string; action?: string }
): void {
  if (!user) {
    throw new AuthorizationError(401, "Authentication required. Please sign in.");
  }

  if (!hasPermission(user.role, permission)) {
    // Record audit event for authorization failure
    try {
      recordAuditEvent({
        actorId: user.id,
        actorUsername: user.username,
        action: "auth.forbidden",
        targetType: "permission",
        targetId: permission,
        metadata: {
          attemptedPermission: permission,
          userRole: user.role,
          targetId: context?.targetId,
          intendedAction: context?.action,
        },
        ipAddress: context?.ip,
      });
    } catch (auditErr) {
      console.error("Failed to record authorization failure audit log:", auditErr);
    }

    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
}

/**
 * Standard JSON response for unauthenticated access (HTTP 401).
 */
export function unauthorizedResponse(message = "Authentication required. Please sign in."): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Standard JSON response for forbidden access (HTTP 403).
 */
export function forbiddenResponse(message = "Access denied. Insufficient permissions."): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Handles AuthorizationError in route catch blocks, returning 401 or 403 respectively.
 * Returns null if the error is not an AuthorizationError.
 */
export function handleAuthorizationError(error: unknown): NextResponse | null {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }
  return null;
}
