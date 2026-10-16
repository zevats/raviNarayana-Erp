import { NextRequest, NextResponse } from "next/server";
import { validateSessionDetailed, ERP_COOKIE_NAME } from "../authentication/auth";
import { hasPermission } from "./permissions";
import { recordAuditEvent } from "../audit/audit";
import { AuthenticatedUser, Permission } from "@/types";

export class AuthorizationError extends Error {
  public readonly statusCode: 401 | 403;
  public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "SESSION_PREEMPTED";

  constructor(
    statusCode: 401 | 403,
    message: string,
    code?: "UNAUTHENTICATED" | "FORBIDDEN" | "SESSION_PREEMPTED"
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.statusCode = statusCode;
    this.code = code || (statusCode === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
  }
}

/**
 * Resolves the authenticated user from the HTTP request session cookie.
 * Inactive accounts automatically fail session validation and return null.
 * Detects preempted sessions and throws AuthorizationError(401, ..., "SESSION_PREEMPTED").
 */
export function resolveUserFromRequest(request: NextRequest): AuthenticatedUser | null {
  const sessionToken = request.cookies.get(ERP_COOKIE_NAME)?.value;
  if (!sessionToken || sessionToken.length < 32) {
    return null;
  }

  const { user, isPreempted } = validateSessionDetailed(sessionToken);
  if (isPreempted) {
    throw new AuthorizationError(
      401,
      "Session has been invalidated by a login from another device or location",
      "SESSION_PREEMPTED"
    );
  }

  return user;
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
export function unauthorizedResponse(
  message = "Authentication required. Please sign in.",
  code: "UNAUTHENTICATED" | "SESSION_PREEMPTED" = "UNAUTHENTICATED"
): NextResponse {
  return NextResponse.json({ error: message, code }, { status: 401 });
}

/**
 * Standard JSON response for forbidden access (HTTP 403).
 */
export function forbiddenResponse(
  message = "Access denied. Insufficient permissions."
): NextResponse {
  return NextResponse.json({ error: message, code: "FORBIDDEN" }, { status: 403 });
}

/**
 * Handles AuthorizationError in route catch blocks, returning 401 or 403 respectively.
 * Returns null if the error is not an AuthorizationError.
 */
export function handleAuthorizationError(error: unknown): NextResponse | null {
  if (error instanceof AuthorizationError) {
    const response = NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
    if (error.code === "SESSION_PREEMPTED") {
      response.cookies.set({
        name: ERP_COOKIE_NAME,
        value: "",
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
    }
    return response;
  }
  return null;
}
