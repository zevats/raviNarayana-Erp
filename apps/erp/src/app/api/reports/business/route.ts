import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getMultiDivisionFinancialReport,
  getInvoiceAgeingReport,
  getOperationalReconciliationReport,
  getPropertyCapacityAudit,
} from "@/server/reports/businessReportingService";
import { ClosingDivision } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "financial";
    const division = (url.searchParams.get("division") as ClosingDivision) || "COMBINED";
    const startDate = url.searchParams.get("startDate") || undefined;
    const endDate = url.searchParams.get("endDate") || undefined;
    const asOfDate = url.searchParams.get("asOfDate") || undefined;

    switch (type) {
      case "financial": {
        const report = await getMultiDivisionFinancialReport(user, { startDate, endDate });
        return NextResponse.json({ success: true, type: "financial", report });
      }

      case "ageing": {
        const report = await getInvoiceAgeingReport(user, { division, asOfDate });
        return NextResponse.json({ success: true, type: "ageing", report });
      }

      case "operational": {
        const report = await getOperationalReconciliationReport(user, { division, startDate, endDate });
        return NextResponse.json({ success: true, type: "operational", report });
      }

      case "capacity": {
        const report = await getPropertyCapacityAudit(user);
        return NextResponse.json({ success: true, type: "capacity", report });
      }

      default: {
        return NextResponse.json(
          { error: `Unknown report type '${type}'. Valid types: financial, ageing, operational, capacity.` },
          { status: 400 }
        );
      }
    }
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to generate business report." },
      { status: 400 }
    );
  }
}
