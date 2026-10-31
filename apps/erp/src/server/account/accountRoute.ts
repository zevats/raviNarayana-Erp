import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ERP_COOKIE_NAME } from "../authentication/auth";
import { databaseErrorResponse } from "../database/availability";
import { AccountError, AccountClient } from "./accountService";
import { getClientIp } from "../authentication/ip";

/** SHA-256 of this request's session token (to keep the current device signed in). */
export function currentTokenHash(request: NextRequest): string | null {
  const token = request.cookies.get(ERP_COOKIE_NAME)?.value;
  return token ? crypto.createHash("sha256").update(token).digest("hex") : null;
}

/** IP and user agent of this request, for rate limits, audit and the device name in emails. */
export function accountClient(request: NextRequest): AccountClient {
  return { ip: getClientIp(request), userAgent: request.headers.get("user-agent") };
}

export function accountError(route: string, error: any): NextResponse {
  if (error instanceof AccountError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
  const dbError = databaseErrorResponse(route, error);
  if (dbError) return dbError;
  console.error(`${route} failed`, error);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
