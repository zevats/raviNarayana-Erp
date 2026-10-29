import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listTiffinProducts,
  createTiffinProduct,
} from "@/server/tiffin/tiffinService";
import { getClientIp } from "@/server/authentication/ip";
import { ProductCategory, ProductStatus } from "@/types";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES: ProductCategory[] = [
  "STANDARD_MEAL",
  "SUBSCRIPTION_PACKAGE",
  "EXTRA",
  "BEVERAGE",
  "SPECIAL",
];
const VALID_STATUSES: ProductStatus[] = ["ACTIVE", "INACTIVE"];

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);

    // Validate category filter
    const catRaw = url.searchParams.get("category");
    let category: ProductCategory | undefined = undefined;
    if (catRaw && catRaw.trim().length > 0 && catRaw.trim().toUpperCase() !== "ALL") {
      const normalizedCat = catRaw.trim().toUpperCase() as ProductCategory;
      if (!VALID_CATEGORIES.includes(normalizedCat)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid category parameter '${catRaw}'. Allowed values: ${VALID_CATEGORIES.join(", ")}, ALL.`,
          },
          { status: 400 }
        );
      }
      category = normalizedCat;
    }

    // Validate status filter
    const statusRaw = url.searchParams.get("status");
    let status: ProductStatus | undefined = undefined;
    if (statusRaw && statusRaw.trim().length > 0 && statusRaw.trim().toUpperCase() !== "ALL") {
      const normalizedStatus = statusRaw.trim().toUpperCase() as ProductStatus;
      if (!VALID_STATUSES.includes(normalizedStatus)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid status parameter '${statusRaw}'. Allowed values: ACTIVE, INACTIVE, ALL.`,
          },
          { status: 400 }
        );
      }
      status = normalizedStatus;
    }

    const products = await listTiffinProducts(user, { category, status });

    return NextResponse.json({ success: true, products });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    console.error("[API_TIFFIN_PRODUCTS_GET_ERROR]", error);
    const statusCode = error.statusCode || 500;
    return NextResponse.json(
      { success: false, error: error.message || "Failed to load products." },
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
    const product = await createTiffinProduct(user, body, clientIp);

    return NextResponse.json({ success: true, product }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    const isClientValidation =
      error.message?.includes("required") ||
      error.message?.includes("code") ||
      error.message?.includes("price") ||
      error.message?.includes("already exists");

    return NextResponse.json(
      { success: false, error: error.message || "Failed to create product." },
      { status: isClientValidation ? 400 : (error.statusCode || 500) }
    );
  }
}
