import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import { resolveUserFromRequest, unauthorizedResponse, handleAuthorizationError } from "@/server/authorization/authorize";
import { hasPermission } from "@/server/authorization/permissions";
import { REPORTS, ReportKey, runReport, runReportForExport, reportToCsv } from "@/server/reports/reportsService";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports                       → the reports this person can open
 * GET /api/reports?key=…&from&to&division&search&residentId&limit&offset → one report (JSON)
 * GET /api/reports?key=…&format=csv      → the whole report as CSV (formula-injection safe)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const p = new URL(request.url).searchParams;
    const key = p.get("key") as ReportKey | null;
    if (!key) {
      return NextResponse.json({
        success: true,
        reports: REPORTS.filter((r) => hasPermission(user.role, r.permission)).map(({ key, title, description, divisions }) => ({ key, title, description, divisions })),
      });
    }
    const options = {
      from: p.get("from") || undefined,
      to: p.get("to") || undefined,
      division: (p.get("division") as any) || undefined,
      search: p.get("search") || undefined,
      residentId: p.get("residentId") || undefined,
      limit: Number(p.get("limit")) || undefined,
      offset: Number(p.get("offset")) || undefined,
    };
    if (p.get("format") === "csv") {
      const report = await runReportForExport(user, key, options);
      return new NextResponse("﻿" + reportToCsv(report), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ravinarayan-${key}-${report.from}-to-${report.to}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ success: true, report: await runReport(user, key, options) });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/reports", error);
    if (dbError) return dbError;
    return NextResponse.json({ error: error.message || "Could not run the report." }, { status: 400 });
  }
}
