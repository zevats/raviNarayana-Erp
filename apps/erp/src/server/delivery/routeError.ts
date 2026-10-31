import { NextResponse } from "next/server";
import { databaseErrorResponse } from "../database/availability";
import { handleAuthorizationError } from "../authorization/authorize";
import { DeliveryOpsUnavailableError } from "./deliveryRules";

/** Error response for delivery API routes: 401/403, database outage, 409 before migration 0014, else 400. */
export function deliveryRouteError(route: string, error: any, fallback: string): NextResponse {
  const authError = handleAuthorizationError(error);
  if (authError) return authError;
  const dbError = databaseErrorResponse(route, error);
  if (dbError) return dbError;
  if (error instanceof DeliveryOpsUnavailableError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
  }
  return NextResponse.json({ error: error?.message || fallback }, { status: 400 });
}
