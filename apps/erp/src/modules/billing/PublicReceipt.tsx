"use client";

import React, { useEffect } from "react";
import { ArrowLeft, Download, Share2 } from "lucide-react";
import type { Receipt } from "@/lib/receipts";
import { receiptShareText } from "@/lib/receipts";
import { ReceiptDocument } from "./ReceiptDocument";

/** The page a customer opens from the receipt link: the receipt, with Save (PDF / print) and Share. */
export function PublicReceipt({ receipt, print, inApp }: { receipt: Receipt; print: boolean; inApp: boolean }) {
  useEffect(() => {
    document.title = `Receipt ${receipt.receiptNumber} · ${receipt.snapshot.company.name}`;
    if (!print) return;
    const t = window.setTimeout(() => window.print(), 700);
    return () => window.clearTimeout(t);
  }, [print, receipt.receiptNumber, receipt.snapshot.company.name]);

  const share = async () => {
    const url = window.location.origin + window.location.pathname;
    const text = receiptShareText(receipt, receipt.snapshot.company.name, url);
    try {
      if (typeof navigator.share === "function") return await navigator.share({ title: `Receipt ${receipt.receiptNumber}`, text });
      await navigator.clipboard.writeText(text);
      window.alert("Copied. Paste it in any app.");
    } catch {}
  };

  return (
    <div className="rn-public-doc min-h-screen bg-[#EEF1EA] print:bg-white">
      <div className="mx-auto w-full max-w-[760px] px-3 sm:px-0 py-4 sm:py-8 print:p-0 print:max-w-none">
        <div className="mb-3 flex items-center justify-between gap-2 print:hidden">
          {inApp ? (
            <button type="button" onClick={() => window.history.back()} className="inline-flex items-center gap-2 h-11 px-4 rounded-full bg-white text-[14.5px] font-semibold text-[#1E3A2B] shadow-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={share} className="inline-flex items-center gap-2 h-11 px-4 rounded-full bg-white text-[14.5px] font-semibold text-[#1E3A2B] shadow-sm">
              <Share2 className="w-4 h-4" /> Share
            </button>
            {!inApp && (
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[#1E3A2B] text-[14.5px] font-semibold text-white shadow-sm">
                <Download className="w-4 h-4" /> Save PDF
              </button>
            )}
          </div>
        </div>
        <div className="rounded-2xl overflow-hidden bg-white shadow-[0_24px_60px_-30px_rgba(18,28,22,0.45)] print:shadow-none print:rounded-none">
          <ReceiptDocument receipt={receipt} />
        </div>
      </div>
    </div>
  );
}
