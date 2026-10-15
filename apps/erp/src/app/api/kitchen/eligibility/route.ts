import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { getEligibleResidentsForDate } from "@/server/kitchen/kitchenService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const serviceDate = url.searchParams.get("serviceDate");

    if (!serviceDate) {
      return NextResponse.json(
        { error: "Query parameter 'serviceDate' (YYYY-MM-DD) is required." },
        { status: 400 }
      );
    }

    const eligibleResidents = getEligibleResidentsForDate(user, serviceDate);

    return NextResponse.json({
      success: true,
      serviceDate,
      count: eligibleResidents.length,
      residents: eligibleResidents,
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to calculate resident meal eligibility." },
      { status: 400 }
    );
  }
}
