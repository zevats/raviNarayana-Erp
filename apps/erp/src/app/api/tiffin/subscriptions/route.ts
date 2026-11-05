import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listTiffinSubscriptions,
  createTiffinSubscription,
} from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";
import { SubscriptionStatus, SubscriptionMealTypes, SubscriptionServiceDays } from "@/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: SubscriptionStatus[] = ["ACTIVE", "PAUSED", "CANCELLED", "COMPLETED"];
const VALID_MEAL_TYPES: SubscriptionMealTypes[] = ["LUNCH", "DINNER", "BOTH", "BREAKFAST"];
const VALID_SERVICE_DAYS: SubscriptionServiceDays[] = ["ALL_DAYS", "MON_SAT", "MON_FRI"];

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const searchRaw = url.searchParams.get("search");
    const search = searchRaw && searchRaw.trim().length > 0 ? searchRaw.trim() : undefined;
    const customerId = url.searchParams.get("customerId")?.trim() || undefined;
    const productId = url.searchParams.get("productId")?.trim() || undefined;
    const startDate = url.searchParams.get("startDate")?.trim() || undefined;
    const endDate = url.searchParams.get("endDate")?.trim() || undefined;

    // Validate status
    const statusRaw = url.searchParams.get("status");
    let status: SubscriptionStatus | undefined = undefined;
    if (statusRaw && statusRaw.trim().length > 0 && statusRaw.trim().toUpperCase() !== "ALL") {
      const normalizedStatus = statusRaw.trim().toUpperCase() as SubscriptionStatus;
      if (!VALID_STATUSES.includes(normalizedStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid status parameter '${statusRaw}'. Allowed values: ${VALID_STATUSES.join(", ")}, ALL.` },
          { status: 400 }
        );
      }
      status = normalizedStatus;
    }

    // Validate mealTypes
    const mealRaw = url.searchParams.get("mealTypes");
    let mealTypes: SubscriptionMealTypes | undefined = undefined;
    if (mealRaw && mealRaw.trim().length > 0 && mealRaw.trim().toUpperCase() !== "ALL") {
      const normalizedMeal = mealRaw.trim().toUpperCase() as SubscriptionMealTypes;
      if (!VALID_MEAL_TYPES.includes(normalizedMeal)) {
        return NextResponse.json(
          { success: false, error: `Invalid mealTypes parameter '${mealRaw}'. Allowed values: ${VALID_MEAL_TYPES.join(", ")}, ALL.` },
          { status: 400 }
        );
      }
      mealTypes = normalizedMeal;
    }

    // Validate serviceDays
    const daysRaw = url.searchParams.get("serviceDays");
    let serviceDays: SubscriptionServiceDays | undefined = undefined;
    if (daysRaw && daysRaw.trim().length > 0 && daysRaw.trim().toUpperCase() !== "ALL") {
      const normalizedDays = daysRaw.trim().toUpperCase() as SubscriptionServiceDays;
      if (!VALID_SERVICE_DAYS.includes(normalizedDays)) {
        return NextResponse.json(
          { success: false, error: `Invalid serviceDays parameter '${daysRaw}'. Allowed values: ${VALID_SERVICE_DAYS.join(", ")}, ALL.` },
          { status: 400 }
        );
      }
      serviceDays = normalizedDays;
    }

    // Validate limit & offset
    const limitRaw = url.searchParams.get("limit");
    let limit: number | undefined = undefined;
    if (limitRaw !== null && limitRaw !== undefined && limitRaw.trim().length > 0) {
      const parsedLimit = Number(limitRaw);
      if (isNaN(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > 200) {
        return NextResponse.json(
          { success: false, error: "Invalid limit parameter. Must be an integer between 1 and 200." },
          { status: 400 }
        );
      }
      limit = parsedLimit;
    }

    const offsetRaw = url.searchParams.get("offset");
    let offset: number | undefined = undefined;
    if (offsetRaw !== null && offsetRaw !== undefined && offsetRaw.trim().length > 0) {
      const parsedOffset = Number(offsetRaw);
      if (isNaN(parsedOffset) || !Number.isInteger(parsedOffset) || parsedOffset < 0) {
        return NextResponse.json(
          { success: false, error: "Invalid offset parameter. Must be a non-negative integer." },
          { status: 400 }
        );
      }
      offset = parsedOffset;
    }

    const result = await listTiffinSubscriptions(user, {
      customerId,
      productId,
      status,
      mealTypes,
      serviceDays,
      search,
      startDate,
      endDate,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/subscriptions", error);
    if (dbError) return dbError;

    console.error("[API_TIFFIN_SUBSCRIPTIONS_GET_ERROR]", error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load subscriptions." },
      { status: statusCode }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON request payload." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const subscription = await createTiffinSubscription(user, body, clientIp);

    return NextResponse.json({ success: true, subscription }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/subscriptions", error);
    if (dbError) return dbError;

    const isClientValidation =
      error.message?.includes("required") ||
      error.message?.includes("not found") ||
      error.message?.includes("inactive") ||
      error.message?.includes("earlier than") ||
      error.message?.includes("characters long") ||
      error.message?.includes("must be") ||
      error.message?.includes("Invalid");

    return NextResponse.json(
      { success: false, error: error.message || "Failed to create subscription." },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
