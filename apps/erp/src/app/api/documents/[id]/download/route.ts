import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { downloadDocument } from "@/server/documents/documentService";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const dispositionType = url.searchParams.get("disposition") === "attachment" ? "attachment" : "inline";

    const { buffer, mimeType, displayFilename, fileSize } = await downloadDocument(
      user,
      params.id,
      getClientIp(request)
    );

    // Return binary stream with strict security headers
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${dispositionType}; filename="${displayFilename}"`,
        "Content-Length": String(fileSize),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to download document." },
      { status: 400 }
    );
  }
}
