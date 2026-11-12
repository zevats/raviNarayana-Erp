import { archiveIdleCustomersSoon } from "@/server/tiffin/customerArchive";
import { getAsyncDb } from "@/server/database/db";
import { friendlyError } from "@/lib/friendlyError";
import { syncResidentCustomers } from "@/server/tiffin/residentCustomers";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listTiffinCustomers,
  createTiffinCustomer,
} from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";
import { CustomerStatus, CustomerType, DietaryPreference } from "@/types";

export const dynamic = "force-dynamic";

const VALID_STATUSES: CustomerStatus[] = ["ACTIVE", "INACTIVE"];
const VALID_TYPES: CustomerType[] = ["INDIVIDUAL", "CORPORATE", "RESIDENTIAL_PG"];
const VALID_DIETS: DietaryPreference[] = ["VEG", "NON_VEG", "JAIN"];

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const searchRaw = url.searchParams.get("search");
    const search = searchRaw && searchRaw.trim().length > 0 ? searchRaw.trim() : undefined;

    // Validate status filter
    const statusRaw = url.searchParams.get("status");
    let status: CustomerStatus | undefined = undefined;
    if (statusRaw && statusRaw.trim().length > 0 && statusRaw.trim().toUpperCase() !== "ALL") {
      const normalizedStatus = statusRaw.trim().toUpperCase() as CustomerStatus;
      if (!VALID_STATUSES.includes(normalizedStatus)) {
        return NextResponse.json(
          { success: false, error: `Invalid status parameter '${statusRaw}'. Allowed values: ACTIVE, INACTIVE, ALL.` },
          { status: 400 }
        );
      }
      status = normalizedStatus;
    }

    // Validate customerType filter
    const typeRaw = url.searchParams.get("customerType");
    let customerType: CustomerType | undefined = undefined;
    if (typeRaw && typeRaw.trim().length > 0 && typeRaw.trim().toUpperCase() !== "ALL") {
      const normalizedType = typeRaw.trim().toUpperCase() as CustomerType;
      if (!VALID_TYPES.includes(normalizedType)) {
        return NextResponse.json(
          { success: false, error: `Invalid customerType parameter '${typeRaw}'. Allowed values: INDIVIDUAL, CORPORATE, RESIDENTIAL_PG, ALL.` },
          { status: 400 }
        );
      }
      customerType = normalizedType;
    }

    // Validate dietaryPreference filter
    const dietRaw = url.searchParams.get("dietaryPreference");
    let dietaryPreference: DietaryPreference | undefined = undefined;
    if (dietRaw && dietRaw.trim().length > 0 && dietRaw.trim().toUpperCase() !== "ALL") {
      const normalizedDiet = dietRaw.trim().toUpperCase() as DietaryPreference;
      if (!VALID_DIETS.includes(normalizedDiet)) {
        return NextResponse.json(
          { success: false, error: `Invalid dietaryPreference parameter '${dietRaw}'. Allowed values: VEG, NON_VEG, JAIN, ALL.` },
          { status: 400 }
        );
      }
      dietaryPreference = normalizedDiet;
    }

    // Validate pagination parameters
    const limitRaw = url.searchParams.get("limit");
    // The order form's picker asks for everyone at once (up to 2,000, light rows).
    const picker = url.searchParams.get("picker") === "1";
    const maxLimit = picker ? 2000 : 200;
    let limit: number | undefined = undefined;
    if (limitRaw !== null && limitRaw !== undefined && limitRaw.trim().length > 0) {
      const parsedLimit = Number(limitRaw);
      if (isNaN(parsedLimit) || !Number.isInteger(parsedLimit) || parsedLimit <= 0 || parsedLimit > maxLimit) {
        return NextResponse.json(
          { success: false, error: `Invalid limit parameter. Must be an integer between 1 and ${maxLimit}.` },
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

    // PG residents who are not yet tiffin customers are added first (only missing ones).
    // Housekeeping runs in the background (throttled): the list never waits for it.
    void syncResidentCustomers(user).catch(() => {});
    // Customers with no order for 25 days leave the list (set inactive, never deleted).
    void archiveIdleCustomersSoon(getAsyncDb(), user).catch(() => {});
    const result = await listTiffinCustomers(user, {
      search,
      status,
      customerType,
      dietaryPreference,
      limit,
      offset,
      picker,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/customers", error);
    if (dbError) return dbError;

    console.error("[API_TIFFIN_CUSTOMERS_GET_ERROR]", error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { success: false, error: friendlyError(error.message || "Failed to load customers.") },
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
    const customer = await createTiffinCustomer(user, body, clientIp);

    return NextResponse.json({ success: true, customer }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/tiffin/customers", error);
    if (dbError) return dbError;

    if (error.message?.includes("POTENTIAL_DUPLICATE")) {
      const text = String(error.message).replace("POTENTIAL_DUPLICATE: ", "");
      return NextResponse.json({ success: false, duplicateWarning: true, isDuplicate: true, error: text, message: text }, { status: 409 });
    }

    const isClientValidation =
      error.message?.includes("required") ||
      error.message?.includes("characters long") ||
      error.message?.includes("Invalid phone");

    return NextResponse.json(
      { success: false, error: friendlyError(error.message || "Failed to create customer.") },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
