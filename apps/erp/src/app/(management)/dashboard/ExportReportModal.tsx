"use client";

import React, { useState } from "react";
import { Download, Printer, FileText, X, Check, ArrowRight } from "lucide-react";

interface ExportReportModalProps {
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

export function ExportReportModal({ summary }: ExportReportModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadCsv = async () => {
    try {
      setDownloading(true);
      const res = await fetch("/api/reports/executive");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const todayIso = new Date().toISOString().slice(0, 10);
      a.download = `ravinarayan_executive_report_${todayIso}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download CSV report:", err);
      alert("Unable to generate CSV report. Please try again.");
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

      {/* Modal Backdrop & Dialog */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs no-print">
          <div
            className="w-full max-w-lg bg-[#FAF8F5] rounded-2xl border border-[#8E9F89]/30 shadow-2xl overflow-hidden transition-all animate-in fade-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            {/* Modal Header */}
            <div className="bg-[#1A2E20] text-white px-6 py-5 flex items-center justify-between border-b border-[#263B2D]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#263B2D] border border-[#B58A57]/30 flex items-center justify-center text-[#B58A57]">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="modal-title" className="text-base font-semibold tracking-wide text-white">
                    Executive Report Export
                  </h3>
                  <p className="text-[11px] text-[#A8B9A1] mt-0.5">
                    Authorized for Dr. Ravinder Gulia &bull; Owner
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-white/60 hover:text-white transition-colors p-1 rounded-md"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              <p className="text-xs text-[#3E4E42] leading-relaxed">
                Generate an official, database-backed operational briefing. Select your preferred format below:
              </p>

              {/* Option Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* CSV Option */}
                <div className="p-4 rounded-xl bg-white border border-[#8E9F89]/25 hover:border-[#B58A57] transition-all flex flex-col justify-between shadow-2xs group">
                  <div className="space-y-2">
                    <div className="w-8 h-8 rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center text-[#1A2E20] group-hover:text-[#B58A57] transition-colors">
                      <Download className="w-4 h-4" />
                    </div>
                    <h4 className="text-xs font-semibold text-[#1A2E20]">
                      Data Spreadsheet (.csv)
                    </h4>
                    <p className="text-[11px] text-[#5A6C5E] leading-normal">
                      RFC 4180 compliant CSV with formula protection. Complete metric breakdown.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadCsv}
                    disabled={downloading}
                    className="mt-4 w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#1A2E20] text-white hover:bg-[#263B2D] text-xs font-medium transition-colors shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{downloading ? "Generating..." : "Download CSV"}</span>
                  </button>
                </div>

                {/* Printable PDF Option */}
                <div className="p-4 rounded-xl bg-white border border-[#8E9F89]/25 hover:border-[#B58A57] transition-all flex flex-col justify-between shadow-2xs group">
                  <div className="space-y-2">
                    <div className="w-8 h-8 rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center text-[#1A2E20] group-hover:text-[#B58A57] transition-colors">
                      <Printer className="w-4 h-4" />
                    </div>
                    <h4 className="text-xs font-semibold text-[#1A2E20]">
                      Printable PDF Report
                    </h4>
                    <p className="text-[11px] text-[#5A6C5E] leading-normal">
                      Clean A4 executive layout. Ready for printing or saving directly to PDF.
                    </p>
                  </div>
                  <button
                    onClick={handlePrint}
                    className="mt-4 w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-[#B58A57] text-white hover:bg-[#9E7443] text-xs font-medium transition-colors shadow-2xs"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print / Save PDF</span>
                  </button>
                </div>
              </div>

              {/* Data Invariants Verification Card */}
              <div className="bg-[#FAF8F5] border border-[#8E9F89]/20 rounded-xl p-3.5 text-[11px] text-[#5A6C5E] space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[#1A2E20]">
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Real-time Verified Figures</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] pt-1">
                  <div>Occupancy: <strong className="text-[#1A2E20]">{summary.occupancyRate}% ({summary.occupiedBeds}/{summary.totalCapacity})</strong></div>
                  <div>Rent MTD: <strong className="text-[#1A2E20]">₹{summary.currentMonthRent.toLocaleString("en-IN")}</strong></div>
                  <div>Outstanding: <strong className="text-[#1A2E20]">₹{summary.outstandingRent.toLocaleString("en-IN")}</strong></div>
                  <div>Tiffin Net: <strong className="text-[#1A2E20]">₹{summary.tiffinNetResult.toLocaleString("en-IN")}</strong></div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-[#FAF8F5] px-6 py-3.5 border-t border-[#8E9F89]/20 flex justify-end">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-stone-200/50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
