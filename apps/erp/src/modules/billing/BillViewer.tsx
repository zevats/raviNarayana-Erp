"use client";

import React, { useState } from "react";
import { Copy, Download, Mail, MessageSquare, Share2 } from "lucide-react";
import type { Bill } from "@/lib/bills";
import { billDay, billShareText, whatsappLink } from "@/lib/bills";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { isNativeApp } from "@/lib/native";
import { BillDocument } from "./BillDocument";
import { billLink, loadBill, methodLabel, money } from "./api";
import { saveBillPdf, shareBillNative } from "./billFile";

/** The WhatsApp mark (single colour, follows the text colour). */
export function WhatsAppIcon({ className = "w-[18px] h-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.23-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.23 9.43-9.44 9.43m8.03-17.46A11.27 11.27 0 0 0 12.05.72C5.8.72.71 5.8.7 12.06c0 2 .52 3.95 1.52 5.67L.6 23.3l5.7-1.5a11.33 11.33 0 0 0 5.74 1.47h.01c6.25 0 11.34-5.09 11.34-11.34 0-3.03-1.18-5.88-3.32-8.02" />
    </svg>
  );
}

/** Opens a link outside the app (WhatsApp, mail, messages). */
export function openOutside(url: string) {
  if (isNativeApp() || /^(mailto|sms):/.test(url)) window.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
}

export function shareOnWhatsApp(bill: Pick<Bill, "accountName" | "accountPhone" | "billNumber" | "total" | "issueDate" | "token">, company: string) {
  openOutside(whatsappLink(bill.accountPhone, billShareText(bill, company, billLink(bill.token))));
}

/**
 * Share choices for a device without its own share list (most computers): WhatsApp, SMS, email,
 * copy the link, or download the PDF. Used for bills and receipts.
 */
export function DocShareSheet({ open, onClose, title, subtitle, link, text, phone, onPdf }: { open: boolean; onClose: () => void; title: string; subtitle: string; link: string; text: string; phone: string | null; onPdf: () => void }) {
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  const items: Array<{ key: string; label: string; icon: React.ReactNode; tone: string; run: () => void }> = [
    { key: "wa", label: "WhatsApp", icon: <WhatsAppIcon className="w-6 h-6" />, tone: "bg-[#25D366] text-white", run: () => openOutside(whatsappLink(phone, text)) },
    { key: "sms", label: "Message", icon: <MessageSquare className="w-6 h-6" />, tone: "bg-[#E8F0FE] text-[#1A56DB]", run: () => openOutside(`sms:${digits}?body=${encodeURIComponent(text)}`) },
    { key: "mail", label: "Email", icon: <Mail className="w-6 h-6" />, tone: "bg-[#FDECE8] text-[#B4441D]", run: () => openOutside(`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`) },
    {
      key: "copy",
      label: "Copy link",
      icon: <Copy className="w-6 h-6" />,
      tone: "bg-[#EEEAE2] text-[#1E2320]",
      run: async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast.ok("Link copied");
        } catch {
          toast.error("Could not copy the link.");
        }
      },
    },
    { key: "pdf", label: "PDF", icon: <Download className="w-6 h-6" />, tone: "bg-[#E4F2E0] text-[#1D4E16]", run: onPdf },
  ];
  return (
    <Dialog open={open} onClose={onClose} title={`Share ${title.split(" ")[0].toLowerCase()}`} description={subtitle} size="sm">
      <div className="grid grid-cols-5 gap-2 pb-1" role="list">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            role="listitem"
            onClick={() => {
              onClose();
              it.run();
            }}
            className="rn-share-tile"
          >
            <span className={`grid place-items-center w-12 h-12 rounded-full ${it.tone}`}>{it.icon}</span>
            <span className="text-[12px] font-medium text-[var(--rn-ink)] leading-tight text-center">{it.label}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/**
 * A bill on screen with Save, Share and WhatsApp. Give it the bill just made, or an id / number to
 * load a bill kept on record.
 */
export function BillViewer({ bill: given, billId, onClose }: { bill?: Bill | null; billId?: string | null; onClose: () => void }) {
  const q = useErpQuery<Bill>(!given && billId ? `bill:${billId}` : null, () => loadBill(billId!), { ttl: 60000, tags: ["bills"] });
  const bill = given ?? q.data ?? null;
  const open = Boolean(given || billId);
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [sheet, setSheet] = useState(false);
  const company = bill?.snapshot.company.name || "Ravinarayan";

  const save = async () => {
    if (!bill || busy) return;
    setBusy("save");
    await saveBillPdf(bill);
    setBusy(null);
  };
  const share = async () => {
    if (!bill || busy) return;
    setBusy("share");
    const done = await shareBillNative(bill);
    setBusy(null);
    if (!done) setSheet(true);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={bill ? `Bill ${bill.billNumber}` : "Bill"}
        size="lg"
        footer={
          bill ? (
            <div className="rn-bill-actions">
              <button type="button" className="rn-btn" onClick={save} disabled={busy !== null}>
                <Download /> {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button type="button" className="rn-btn" onClick={share} disabled={busy !== null}>
                <Share2 /> {busy === "share" ? "Opening…" : "Share"}
              </button>
              <button type="button" className="rn-btn rn-btn-whatsapp" onClick={() => shareOnWhatsApp(bill, company)}>
                <WhatsAppIcon /> WhatsApp
              </button>
            </div>
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
      {bill && (
        <DocShareSheet
          open={sheet}
          onClose={() => setSheet(false)}
          title={`Bill ${bill.billNumber}`}
          subtitle={`${bill.billNumber} · ${money(bill.total)}`}
          link={billLink(bill.token)}
          text={billShareText(bill, company, billLink(bill.token))}
          phone={bill.accountPhone}
          onPdf={() => saveBillPdf(bill)}
        />
      )}
    </>
  );
}
