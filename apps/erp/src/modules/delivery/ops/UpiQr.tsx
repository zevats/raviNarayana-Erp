"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { UPI_ID, UPI_NAME, upiPayUri } from "@/lib/upi";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/**
 * UPI QR for the amount being collected (delivery app, UPI chosen). The customer scans it with any
 * UPI app; the amount is pre-filled. Nothing is recorded until the delivery is marked delivered.
 */
export function UpiQr({ amount, note }: { amount: number; note?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
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
    <div className="rn-enter rounded-2xl bg-white border border-[#ECE6DB] p-3 flex items-center gap-3" aria-label="UPI payment QR">
      <div className="shrink-0 w-[132px] h-[132px] rounded-xl bg-white p-1.5 border border-[#F1E3D6]" role="img" aria-label={`QR code to pay ${rupees(amount)} to ${UPI_ID}`}>
        {svg ? <div className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="w-full h-full rounded-lg bg-[#F4F0E8] animate-pulse" />}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#C9501C]">Scan to pay</p>
        <p className="text-[22px] leading-none font-extrabold tabular-nums text-[#1F2320]">{amount > 0 ? rupees(amount) : "Any amount"}</p>
        <p className="text-[12.5px] text-[#5A6C5E] break-all">{UPI_ID}</p>
        <p className="text-[12px] text-[#6E7F70] truncate">{UPI_NAME}</p>
      </div>
    </div>
  );
}
