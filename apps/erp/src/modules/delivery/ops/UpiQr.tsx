"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [big]);
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
      {big &&
        typeof document !== "undefined" &&
        // Drawn at the top of the page (not inside the delivery sheet), centred and sized to the
        // screen so the whole code is visible without scrolling; a tap anywhere outside closes it.
        createPortal(
          <div
            className="rn-enter fixed inset-0 z-[120] flex items-center justify-center p-4 bg-[rgba(20,14,10,0.72)] backdrop-blur-[3px]"
            role="dialog"
            aria-modal="true"
            aria-label="UPI QR code"
            onClick={() => setBig(false)}
          >
            <div
              className="relative w-full max-w-[360px] max-h-[calc(100dvh-2rem)] rounded-[28px] bg-white px-5 pt-5 pb-4 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setBig(false)}
                aria-label="Close"
                className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center text-[#5A6C5E] hover:bg-[#F4F0E8]"
              >
                <X className="w-5 h-5" />
              </button>
              <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-[#C9501C]">Scan to pay</p>
              <p className="mt-1 text-[32px] leading-none font-extrabold tabular-nums text-[#1F2320]">{amount > 0 ? rupees(amount) : "Any amount"}</p>
              <div
                className="mt-4 rounded-2xl border border-[#F1E3D6] p-2.5 bg-white w-[min(78vw,calc(100dvh-15rem),300px)] aspect-square [&>svg]:w-full [&>svg]:h-full"
                role="img"
                aria-label={`QR code to pay ${rupees(amount)} to ${UPI_ID}`}
                dangerouslySetInnerHTML={{ __html: svg || "" }}
              />
              <p className="mt-3 text-[14.5px] font-semibold text-[#1F2320] break-all">{UPI_ID}</p>
              <p className="text-[12.5px] text-[#5A6C5E]">{UPI_NAME}</p>
              <p className="mt-2 text-[11.5px] text-[#8A7F74]">Tap outside to close</p>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
