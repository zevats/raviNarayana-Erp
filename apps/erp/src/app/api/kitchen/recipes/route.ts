import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listRecipes,
  createRecipe,
} from "@/server/kitchen/kitchenInventoryService";
import { getClientIp } from "@/server/authentication/ip";
import { MealType } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const mealType = (url.searchParams.get("mealType") as MealType) || undefined;
    const productId = url.searchParams.get("productId") || undefined;
    const isActiveParam = url.searchParams.get("isActive");
    const isActive = isActiveParam !== null ? isActiveParam === "true" || isActiveParam === "1" : undefined;

    const recipes = await listRecipes(user, {
      mealType,
      productId,
      isActive,
    });

    return NextResponse.json({ success: true, recipes });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to list recipes") }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json();
    const clientIp = getClientIp(request);

    const recipe = await createRecipe(user, body, clientIp);
    return NextResponse.json({ success: true, recipe }, { status: 201 });
  } catch (error: any) {
    const authResp = handleAuthorizationError(error);
    if (authResp) return authResp;
    return NextResponse.json({ error: friendlyError(error.message || "Failed to create recipe") }, { status: 400 });
  }
}
