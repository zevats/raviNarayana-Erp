import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getPrepaidBillingExceptions,
  reconcilePrepaidException,
} from "@/server/tiffin/tiffinBillingService";
import { getClientIp } from "@/server/authentication/ip";
import { ReconcilePrepaidExceptionInput } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const billingPeriod = url.searchParams.get("billingPeriod")?.trim() || undefined;
    const customerId = url.searchParams.get("customerId")?.trim() || undefined;
    const subscriptionId = url.searchParams.get("subscriptionId")?.trim() || undefined;
    const startDate = url.searchParams.get("startDate")?.trim() || undefined;
    const endDate = url.searchParams.get("endDate")?.trim() || undefined;
    const status = (url.searchParams.get("status") as any) || undefined;

    const result = await getPrepaidBillingExceptions(user, {
      billingPeriod,
      customerId,
      subscriptionId,
      startDate,
      endDate,
      status,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/billing/exceptions", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { success: false, error: friendlyError(error.message || "Failed to load prepaid billing exceptions.") },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = (await request.json()) as ReconcilePrepaidExceptionInput;

    if (!body || !body.taskId) {
      return NextResponse.json(
        { success: false, error: "taskId is required." },
        { status: 400 }
      );
    }
    if (!body.resolution) {
      return NextResponse.json(
        { success: false, error: "resolution is required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const result = await reconcilePrepaidException(user, body, clientIp);

    return NextResponse.json({ success: true, reconciliation: result }, { status: 200 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/billing/exceptions", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { success: false, error: friendlyError(error.message || "Failed to reconcile prepaid exception.") },
      { status: 400 }
    );
  }
}
