import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { previewResidentSettlement } from "@/server/residents/residentService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const searchParams = request.nextUrl.searchParams;
    const residentId = searchParams.get("residentId");
    const checkOutDate = searchParams.get("checkOutDate") || undefined;

    if (!residentId) {
      return NextResponse.json(
        { error: "Resident ID is required." },
        { status: 400 }
      );
    }

    const preview = await previewResidentSettlement(user, residentId, checkOutDate);

    return NextResponse.json({
      success: true,
      preview,
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to generate settlement preview." },
      { status: 400 }
    );
  }
}
