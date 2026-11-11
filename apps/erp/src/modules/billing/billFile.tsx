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
 * A document (bill or receipt) as a PDF file: the same page people see on screen, drawn off screen
 * at A4 width and turned into an A4 PDF (more pages if it is long). Made only when someone saves or
 * shares, so the PDF tools load only then.
 */
export async function renderPdf(doc: React.ReactElement, selector: string, fileName: string, title: string): Promise<{ blob: Blob; base64: string; name: string }> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;pointer-events:none;";
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(doc);
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const img = host.querySelector("img");
      const imgDone = !img || (img.complete && img.naturalWidth > 0);
      const qr = host.querySelector("[data-qr]");
      const qrDone = !qr || Boolean(qr.querySelector("svg"));
      if (host.querySelector(selector) && imgDone && qrDone) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    const el = host.querySelector(selector) as HTMLElement;
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
    pdf.setProperties({ title });
    const blob = pdf.output("blob");
    const base64 = (pdf.output("datauristring") as string).split(",")[1] || "";
    return { blob, base64, name: fileName.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/-+/g, "-") };
  } finally {
    root.unmount();
    host.remove();
  }
}

export const makeBillPdf = (bill: Bill) =>
  renderPdf(<BillDocument bill={bill} />, ".rn-bill", `Bill-${bill.billNumber}-${bill.accountName.slice(0, 30)}.pdf`, `Bill ${bill.billNumber}`);

/** Save: the PDF goes to the phone's Downloads (app) or the browser's downloads. `fallbackUrl` opens the document page in an older app. */
export async function savePdf(make: () => Promise<{ blob: Blob; base64: string; name: string }>, label: string, fallbackUrl: string): Promise<void> {
  try {
    const file = await make();
    const native = nativePlugins().RnApp;
    if (isNativeApp() && native?.saveFile) {
      const r = await native.saveFile({ name: file.name, mime: "application/pdf", base64: file.base64 });
      toast.ok(`${label} saved in ${r?.where || "Downloads"}`);
      return;
    }
    if (isNativeApp()) {
      window.location.assign(fallbackUrl);
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
    toast.ok(`${label} downloaded`);
  } catch {
    toast.error(`Could not save the ${label.toLowerCase().split(" ")[0]}. Please try again.`);
  }
}

/**
 * Share: the phone's own "Share via" list (WhatsApp, Gmail, Drive, copy…) with the PDF attached.
 * Returns false when this device has no share list, so the screen can offer its own choices.
 */
export async function sharePdf(make: () => Promise<{ blob: Blob; base64: string; name: string }>, title: string, text: string): Promise<boolean> {
  const native = nativePlugins().RnApp;
  try {
    if (isNativeApp() && native?.shareFile) {
      const file = await make();
      await native.shareFile({ name: file.name, mime: "application/pdf", base64: file.base64, text });
      return true;
    }
    if (typeof navigator.share === "function") {
      try {
        const file = await make();
        const f = new File([file.blob], file.name, { type: "application/pdf" });
        if (navigator.canShare?.({ files: [f] })) {
          await navigator.share({ files: [f], title, text });
          return true;
        }
      } catch (e: any) {
        if (e?.name === "AbortError") return true;
      }
      await navigator.share({ title, text });
      return true;
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return true;
  }
  return false;
}

export const saveBillPdf = (bill: Bill) => savePdf(() => makeBillPdf(bill), `Bill ${bill.billNumber}`, `/bill/${bill.token}?app=1`);

export const shareBillNative = (bill: Bill) => sharePdf(() => makeBillPdf(bill), `Bill ${bill.billNumber}`, billShareText(bill, bill.snapshot.company.name, billLink(bill.token)));
