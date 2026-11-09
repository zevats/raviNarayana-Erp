"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { UPI_ID, UPI_NAME, upiPayUri } from "@/lib/upi";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * UPI QR for the amount being collected (delivery app, UPI chosen). The customer scans it with any
 * UPI app; the amount is pre-filled. Nothing is recorded until the delivery is marked delivered.
 * It scrolls into view when it appears (UPI chosen) and opens large when tapped, for easy scanning.
 */
export function UpiQr({ amount, note }: { amount: number; note?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const t = window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setBig(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [big]);
  const uri = upiPayUri(amount, note);
  useEffect(() => {
    let live = true;
    QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1F2320", light: "#FFFFFF" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return (
    <div ref={boxRef} className="rn-enter rounded-2xl bg-white border border-[#ECE6DB] p-3 flex items-center gap-3 scroll-mt-24" aria-label="UPI payment QR">
      <button
        type="button"
        onClick={() => setBig(true)}
        className="shrink-0 w-[132px] h-[132px] rounded-xl bg-white p-1.5 border border-[#F1E3D6] cursor-zoom-in"
        aria-label="Show the QR code large"
      >
        <span className="block w-full h-full" role="img" aria-label={`QR code to pay ${rupees(amount)} to ${UPI_ID}`}>
          {svg ? <span className="block w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="block w-full h-full rounded-lg bg-[#F4F0E8] animate-pulse" />}
        </span>
      </button>
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#C9501C]">Scan to pay</p>
        <p className="text-[22px] leading-none font-extrabold tabular-nums text-[#1F2320]">{amount > 0 ? rupees(amount) : "Any amount"}</p>
        <p className="text-[12.5px] text-[#5A6C5E] break-all">{UPI_ID}</p>
        <p className="text-[12px] text-[#6E7F70] truncate">{UPI_NAME}</p>
        <p className="text-[11.5px] text-[#8A6A4F]">Tap the code to enlarge</p>
      </div>
      {big && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-5 bg-[rgba(20,14,10,0.78)]"
          role="dialog"
          aria-modal="true"
          aria-label="UPI QR code"
          onClick={() => setBig(false)}
        >
          <div className="w-full max-w-[380px] rounded-[26px] bg-white p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#C9501C]">Scan to pay</p>
            <p className="mt-1 text-[30px] leading-none font-extrabold tabular-nums text-[#1F2320]">{amount > 0 ? rupees(amount) : "Any amount"}</p>
            <div className="mx-auto mt-4 w-[min(78vw,320px)] aspect-square [&>svg]:w-full [&>svg]:h-full" role="img" aria-label={`QR code to pay ${rupees(amount)} to ${UPI_ID}`} dangerouslySetInnerHTML={{ __html: svg || "" }} />
            <p className="mt-3 text-[14px] font-semibold text-[#1F2320] break-all">{UPI_ID}</p>
            <p className="text-[12.5px] text-[#5A6C5E]">{UPI_NAME}</p>
            <button type="button" onClick={() => setBig(false)} className="mt-4 w-full h-12 rounded-full bg-[#1F2320] text-white text-[15px] font-bold">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
