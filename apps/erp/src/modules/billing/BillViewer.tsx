"use client";

import React from "react";
import { Download, MessageCircle, Share2 } from "lucide-react";
import type { Bill } from "@/lib/bills";
import { billDay, billShareText, whatsappLink } from "@/lib/bills";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { isNativeApp } from "@/lib/native";
import { BillDocument } from "./BillDocument";
import { billLink, loadBill, methodLabel, money } from "./api";

/** Opens a link outside the app (WhatsApp, the browser). */
export function openOutside(url: string) {
  if (isNativeApp()) window.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function shareOnWhatsApp(bill: Pick<Bill, "accountName" | "accountPhone" | "billNumber" | "total" | "issueDate" | "token">, company: string) {
  openOutside(whatsappLink(bill.accountPhone, billShareText(bill, company, billLink(bill.token))));
}

/** Share with any app (the phone share sheet), or copy the link where that is not available. */
export async function shareBill(bill: Pick<Bill, "accountName" | "billNumber" | "total" | "issueDate" | "token">, company: string) {
  const url = billLink(bill.token);
  const text = billShareText(bill, company, url);
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title: `Bill ${bill.billNumber}`, text });
      return;
    }
  } catch (e: any) {
    if (e?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.ok("Bill message copied. Paste it in any app.");
  } catch {
    toast.error("Could not copy. Use WhatsApp instead.");
  }
}

/** Save as PDF or print: the bill page opens with the print window (in the app it opens the bill page). */
export function saveBill(token: string) {
  if (isNativeApp()) window.location.assign(`/bill/${token}?app=1`);
  else window.open(`/bill/${token}?print=1`, "_blank", "noopener");
}

/**
 * A bill on screen with Save and Share. Give it the bill just made, or an id / number to load a
 * bill kept on record.
 */
export function BillViewer({ bill: given, billId, onClose }: { bill?: Bill | null; billId?: string | null; onClose: () => void }) {
  const q = useErpQuery<Bill>(!given && billId ? `bill:${billId}` : null, () => loadBill(billId!), { ttl: 60000, tags: ["bills"] });
  const bill = given ?? q.data ?? null;
  const open = Boolean(given || billId);
  const company = bill?.snapshot.company.name || "Ravinarayan";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={bill ? `Bill ${bill.billNumber}` : "Bill"}
      size="lg"
      footer={
        bill ? (
          <>
            <button type="button" className="rn-btn" onClick={() => saveBill(bill.token)}>
              <Download /> Save
            </button>
            <button type="button" className="rn-btn" onClick={() => shareBill(bill, company)}>
              <Share2 /> Share
            </button>
            <button type="button" className="rn-btn rn-btn-primary" onClick={() => shareOnWhatsApp(bill, company)}>
              <MessageCircle /> WhatsApp
            </button>
          </>
        ) : undefined
      }
    >
      {!bill ? (
        q.error ? (
          <LoadError message={q.error.message} onRetry={() => q.refetch()} />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <span className="rn-skel block h-16 w-full rounded-xl" />
            <span className="rn-skel block h-40 w-full rounded-xl" />
            <span className="rn-skel block h-24 w-full rounded-xl" />
          </div>
        )
      ) : (
        <div className="space-y-3 min-w-0">
          {bill.received.length > 0 && (
            <ul className="rounded-2xl bg-[#E4F2E0] px-4 py-2.5 text-[13.5px] text-[#1D4E16]" aria-label="Received against this bill">
              {bill.received.map((p, i) => (
                <li key={i} className="flex justify-between gap-3 py-0.5">
                  <span>
                    Received {billDay(p.date)} · {methodLabel(p.method)}
                  </span>
                  <span className="tabular-nums font-semibold">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-2xl border border-[var(--rn-line)] overflow-hidden bg-white">
            <BillDocument bill={bill} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
