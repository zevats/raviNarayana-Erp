import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getPreparationSheetData } from "@/server/kitchen/kitchenService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const planId = url.searchParams.get("planId");

    if (!planId) {
      return NextResponse.json(
        { error: "Query parameter 'planId' is required." },
        { status: 400 }
      );
    }

    const prepSheet = getPreparationSheetData(user, planId);
    if (!prepSheet) {
      return NextResponse.json({ error: "Meal plan not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, prepSheet });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load preparation sheet." },
      { status: 400 }
    );
  }
}
