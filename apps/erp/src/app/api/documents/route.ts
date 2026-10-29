import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listDocuments,
  uploadDocument,
} from "@/server/documents/documentService";
import { getClientIp } from "@/server/authentication/ip";
import { DocumentCategory, DocumentStatus } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const category = (url.searchParams.get("category") as DocumentCategory) || undefined;
    const residentId = url.searchParams.get("residentId") || undefined;
    const stayId = url.searchParams.get("stayId") || undefined;
    const transactionId = url.searchParams.get("transactionId") || undefined;
    const invoiceId = url.searchParams.get("invoiceId") || undefined;
    const settlementId = url.searchParams.get("settlementId") || undefined;
    const status = (url.searchParams.get("status") as DocumentStatus) || undefined;

    const documents = await listDocuments(
      user,
      { category, residentId, stayId, transactionId, invoiceId, settlementId, status },
      getClientIp(request)
    );

    return NextResponse.json({ success: true, documents });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to list documents." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const contentType = request.headers.get("content-type") || "";

    let category: DocumentCategory;
    let originalFilename: string;
    let fileBuffer: Buffer;
    let residentId: string | undefined;
    let stayId: string | undefined;
    let transactionId: string | undefined;
    let invoiceId: string | undefined;
    let settlementId: string | undefined;
    let notes: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "Missing file payload in form data." }, { status: 400 });
      }

      category = formData.get("category") as DocumentCategory;
      residentId = (formData.get("residentId") as string) || undefined;
      stayId = (formData.get("stayId") as string) || undefined;
      transactionId = (formData.get("transactionId") as string) || undefined;
      invoiceId = (formData.get("invoiceId") as string) || undefined;
      settlementId = (formData.get("settlementId") as string) || undefined;
      notes = (formData.get("notes") as string) || undefined;

      originalFilename = file.name;
      const arrayBuf = await file.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuf);
    } else {
      // JSON payload fallback with base64Content
      const body = await request.json().catch(() => ({}));
      if (!body.base64Content) {
        return NextResponse.json(
          { error: "Missing file payload (multipart/form-data 'file' or JSON 'base64Content')." },
          { status: 400 }
        );
      }

      category = body.category as DocumentCategory;
      residentId = body.residentId || undefined;
      stayId = body.stayId || undefined;
      transactionId = body.transactionId || undefined;
      invoiceId = body.invoiceId || undefined;
      settlementId = body.settlementId || undefined;
      notes = body.notes || undefined;
      originalFilename = body.originalFilename || "document.pdf";
      fileBuffer = Buffer.from(body.base64Content, "base64");
    }

    if (!category) {
      return NextResponse.json({ error: "Document category is required." }, { status: 400 });
    }

    const document = await uploadDocument(
      user,
      {
        category,
        residentId,
        stayId,
        transactionId,
        invoiceId,
        settlementId,
        notes,
        originalFilename,
        fileBuffer,
      },
      clientIp
    );

    return NextResponse.json({ success: true, document }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to upload document." },
      { status: 400 }
    );
  }
}
