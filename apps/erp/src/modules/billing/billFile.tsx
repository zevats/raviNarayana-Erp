"use client";

import React from "react";
import { createRoot } from "react-dom/client";
import type { Bill } from "@/lib/bills";
import { billShareText } from "@/lib/bills";
import { isNativeApp, nativePlugins } from "@/lib/native";
import { toast } from "@/components/ui/toast";
import { BillDocument } from "./BillDocument";
import { billLink } from "./api";

/**
 * The bill as a PDF file: the same bill people see on screen, drawn off screen at A4 width and
 * turned into an A4 PDF (more pages if it is long). Made only when someone saves or shares, so the
 * PDF tools load only then.
 */
export async function makeBillPdf(bill: Bill): Promise<{ blob: Blob; base64: string; name: string }> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<BillDocument bill={bill} />);
    // Wait for the logo and the UPI code to be drawn.
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const img = host.querySelector("img");
      const imgDone = !img || (img.complete && img.naturalWidth > 0);
      const qrDone = !bill.snapshot.company.upiId || Boolean(host.querySelector("[aria-label='UPI payment code'] svg"));
      if (host.querySelector(".rn-bill") && imgDone && qrDone) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    const el = host.querySelector(".rn-bill") as HTMLElement;
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 794 });
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width;
    const data = canvas.toDataURL("image/jpeg", 0.92);
    let y = 0;
    pdf.addImage(data, "JPEG", 0, y, pageW, imgH);
    let left = imgH - pageH;
    while (left > 1) {
      y -= pageH;
      pdf.addPage();
      pdf.addImage(data, "JPEG", 0, y, pageW, imgH);
      left -= pageH;
    }
    pdf.setProperties({ title: `Bill ${bill.billNumber}`, subject: bill.accountName, creator: bill.snapshot.company.name });
    const blob = pdf.output("blob");
    const base64 = (pdf.output("datauristring") as string).split(",")[1] || "";
    const name = `Bill-${bill.billNumber.replace(/[^A-Za-z0-9]+/g, "-")}-${bill.accountName.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 30)}.pdf`.replace(/-+/g, "-");
    return { blob, base64, name };
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Save: the PDF goes to the phone's Downloads (app) or the browser's downloads. */
export async function saveBillPdf(bill: Bill): Promise<void> {
  try {
    const file = await makeBillPdf(bill);
    const native = nativePlugins().RnApp;
    if (isNativeApp() && native?.saveFile) {
      const r = await native.saveFile({ name: file.name, mime: "application/pdf", base64: file.base64 });
      toast.ok(`Bill saved in ${r?.where || "Downloads"}`);
      return;
    }
    if (isNativeApp()) {
      // An older app without file saving: open the bill page to save it from there.
      window.location.assign(`/bill/${bill.token}?app=1`);
      return;
    }
    const url = URL.createObjectURL(file.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast.ok(`Bill ${bill.billNumber} downloaded`);
  } catch {
    toast.error("Could not save the bill. Please try again.");
  }
}

/**
 * Share: the phone's own "Share via" list (WhatsApp, Gmail, Drive, copy…) with the PDF attached.
 * Returns false when this device has no share list, so the screen can offer its own choices.
 */
export async function shareBillNative(bill: Bill): Promise<boolean> {
  const text = billShareText(bill, bill.snapshot.company.name, billLink(bill.token));
  const native = nativePlugins().RnApp;
  try {
    if (isNativeApp() && native?.shareFile) {
      const file = await makeBillPdf(bill);
      await native.shareFile({ name: file.name, mime: "application/pdf", base64: file.base64, text });
      return true;
    }
    if (typeof navigator.share === "function") {
      try {
        const file = await makeBillPdf(bill);
        const f = new File([file.blob], file.name, { type: "application/pdf" });
        if (navigator.canShare?.({ files: [f] })) {
          await navigator.share({ files: [f], title: `Bill ${bill.billNumber}`, text });
          return true;
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return true;
      }
      await navigator.share({ title: `Bill ${bill.billNumber}`, text });
      return true;
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return true;
  }
  return false;
}
