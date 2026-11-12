"use client";

import { downloadCsvText } from "@/lib/csvFile";
import React, { useState } from "react";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { Download, Printer, FileText, X, Check } from "lucide-react";
import { businessToday } from "@/lib/businessDate";

interface ExportReportModalProps {
  division?: string;
  startDate?: string;
  endDate?: string;
  summary: {
    occupiedBeds: number;
    totalCapacity: number;
    occupancyRate: number;
    availableBeds: number;
    currentMonthRent: number;
    outstandingRent: number;
    overdueCount: number;
    tiffinNetResult: number;
    kitchenCosts: number;
    tiffinRevenue: number;
    totalExpenses: number;
    totalMeals: number;
    totalDeliveryTasks: number;
    deliveredCount: number;
    deliveryExceptions: number;
  };
}

export function ExportReportModal({ summary, division, startDate, endDate }: ExportReportModalProps) {
  const currentUser = useCurrentUser();
  const [isOpen, setIsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [format, setFormat] = useState<"csv" | "pdf">("csv");

  const handleDownloadCsv = async () => {
    try {
      setDownloading(true);
      const params = new URLSearchParams();
      if (division) params.set("division", division);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const queryString = params.toString() ? `?${params.toString()}` : "";

      const res = await fetch(`/api/reports/executive${queryString}`);
      if (!res.ok) throw new Error("Export failed");
      const text = await res.text();
      const todayIso = businessToday();
      // The same saving as every other CSV: Downloads in the phone app, a normal download in a browser.
      await downloadCsvText(`ravinarayan_executive_report_${division ? division.toLowerCase() + "_" : ""}${todayIso}.csv`, text);
    } catch (err) {
      console.error("Failed to download CSV report:", err);
      alert("The report could not be prepared. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    setIsOpen(false);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  return (
    <>
      {/* Header Trigger Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="no-print inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-[#1A2E20] border border-[#8E9F89]/40 hover:border-[#1A2E20] hover:bg-[#FAF8F5] text-xs font-semibold tracking-wide transition-all shadow-2xs"
        title="Export executive report as CSV or printable PDF"
      >
        <FileText className="w-4 h-4 text-[#B58A57]" />
        <span>Export Report</span>
      </button>

      {/* Modal: choose a format (two cards), then one action in the footer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 no-print rn-modal-scrim" onClick={() => setIsOpen(false)}>
          <div className="rn-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-[rgba(30,35,32,0.08)]">
              <div className="min-w-0">
                <h3 id="export-title" className="text-[19px] font-semibold text-[#1E2320]">Export report</h3>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close" className="grid place-items-center w-11 h-11 -mr-2 rounded-full text-[#4A504B] hover:bg-black/[0.05]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div role="radiogroup" aria-label="Format" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { v: "csv" as const, icon: <Download className="w-5 h-5" />, title: "Spreadsheet (CSV)" },
                  { v: "pdf" as const, icon: <Printer className="w-5 h-5" />, title: "Printable PDF" },
                ]).map((o) => {
                  const on = format === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setFormat(o.v)}
                      className={`relative text-left rounded-2xl p-4 bg-white transition-colors ${on ? "border-2 border-[#1E3A2B] shadow-[0_8px_24px_-16px_rgba(30,58,43,0.6)]" : "border-2 border-[rgba(30,35,32,0.10)] hover:border-[rgba(30,58,43,0.35)]"}`}
                    >
                      <span className={`grid place-items-center w-10 h-10 rounded-xl ${on ? "bg-[#1E3A2B] text-white" : "bg-[#EEF3EA] text-[#1E3A2B]"}`}>{o.icon}</span>
                      <span className="mt-3 block text-[15px] font-semibold text-[#1E2320]">{o.title}</span>
                      {on && (
                        <span className="absolute right-3 top-3 grid place-items-center w-6 h-6 rounded-full bg-[#1E3A2B] text-white">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-2xl bg-[#F6F3EC] px-4 py-3.5 text-[13px] text-[#3A403C]">
                <p className="flex items-center gap-1.5 font-semibold text-[#1E2320]">
                  <Check className="w-4 h-4 text-[#2F6B24]" /> Included in the report
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                  <span>Occupancy <strong className="text-[#1E2320]">{summary.occupancyRate}%</strong> ({summary.occupiedBeds}/{summary.totalCapacity})</span>
                  <span>Rent this month <strong className="text-[#1E2320]">₹{summary.currentMonthRent.toLocaleString("en-IN")}</strong></span>
                  <span>Rent owed <strong className="text-[#1E2320]">₹{summary.outstandingRent.toLocaleString("en-IN")}</strong></span>
                  <span>Tiffin net <strong className="text-[#1E2320]">₹{summary.tiffinNetResult.toLocaleString("en-IN")}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex justify-end px-6 py-4 border-t border-[rgba(30,35,32,0.08)]">
              <button
                type="button"
                onClick={format === "csv" ? handleDownloadCsv : handlePrint}
                disabled={downloading}
                className="rn-btn-primary inline-flex items-center gap-2 h-12 px-6 rounded-full text-[15px] font-semibold disabled:opacity-60"
              >
                {format === "csv" ? <Download className="w-4 h-4" /> : <Printer className="w-4 h-4" />}
                {format === "csv" ? (downloading ? "Preparing…" : "Download CSV") : "Print or save PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
