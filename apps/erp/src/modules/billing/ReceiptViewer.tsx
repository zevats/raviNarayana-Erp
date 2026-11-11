"use client";

import React, { useState } from "react";
import { Download, Share2 } from "lucide-react";
import type { FinancialTransaction } from "@/types";
import type { Receipt } from "@/lib/receipts";
import { receiptShareText } from "@/lib/receipts";
import { whatsappLink } from "@/lib/bills";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError } from "@/components/ui/states";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { ReceiptDocument } from "./ReceiptDocument";
import { DocShareSheet, WhatsAppIcon, openOutside } from "./BillViewer";
import { renderPdf, savePdf, sharePdf } from "./billFile";
import { getJson, money } from "./api";

const receiptLink = (token: string) => `${window.location.origin}/receipt/${token}`;
const makeReceiptPdf = (r: Receipt) => renderPdf(<ReceiptDocument receipt={r} />, ".rn-receipt", `Receipt-${r.receiptNumber}-${r.accountName.slice(0, 30)}.pdf`, `Receipt ${r.receiptNumber}`);

/** Money received is the only kind of entry with a receipt. */
export const hasReceipt = (tx: Pick<FinancialTransaction, "transactionType" | "status">) =>
  tx.status === "POSTED" && (tx.transactionType === "RENT_PAYMENT" || tx.transactionType === "SECURITY_DEPOSIT" || tx.transactionType === "TIFFIN_PAYMENT");

/** A payment's receipt with Save, Share and WhatsApp (kept on record the first time it opens). */
export function ReceiptViewer({ transactionId, onClose }: { transactionId: string | null; onClose: () => void }) {
  const url = transactionId ? `/api/finance/receipts/${encodeURIComponent(transactionId)}` : null;
  const q = useErpQuery<{ receipt: Receipt }>(url, () => getJson(url!), { ttl: 15000, tags: ["receipts", "finance"] });
  const r = q.data?.receipt ?? null;
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [sheet, setSheet] = useState(false);
  const company = r?.snapshot.company.name || "Ravinarayan";
  const text = r ? receiptShareText(r, company, receiptLink(r.token)) : "";
  const save = async () => {
    if (!r || busy) return;
    setBusy("save");
    await savePdf(() => makeReceiptPdf(r), `Receipt ${r.receiptNumber}`, `/receipt/${r.token}?app=1`);
    setBusy(null);
  };
  const share = async () => {
    if (!r || busy) return;
    setBusy("share");
    const done = await sharePdf(() => makeReceiptPdf(r), `Receipt ${r.receiptNumber}`, text);
    setBusy(null);
    if (!done) setSheet(true);
  };
  return (
    <>
      <Dialog
        open={Boolean(transactionId)}
        onClose={onClose}
        title={r ? `Receipt ${r.receiptNumber}` : "Receipt"}
        size="lg"
        footer={
          r ? (
            <div className="rn-bill-actions">
              <button type="button" className="rn-btn" onClick={save} disabled={busy !== null}>
                <Download /> {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button type="button" className="rn-btn" onClick={share} disabled={busy !== null}>
                <Share2 /> {busy === "share" ? "Opening…" : "Share"}
              </button>
              <button type="button" className="rn-btn rn-btn-whatsapp" onClick={() => openOutside(whatsappLink(r.accountPhone, text))}>
                <WhatsAppIcon /> WhatsApp
              </button>
            </div>
          ) : undefined
        }
      >
        {!r ? (
          q.error ? (
            <LoadError message={q.error.message} onRetry={() => q.refetch()} />
          ) : (
            <div className="space-y-3" aria-busy="true">
              <span className="rn-skel block h-16 w-full rounded-xl" />
              <span className="rn-skel block h-32 w-full rounded-xl" />
              <span className="rn-skel block h-40 w-full rounded-xl" />
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-[var(--rn-line)] overflow-hidden bg-white">
            <ReceiptDocument receipt={r} />
          </div>
        )}
      </Dialog>
      {r && (
        <DocShareSheet
          open={sheet}
          onClose={() => setSheet(false)}
          title={`Receipt ${r.receiptNumber}`}
          subtitle={`${r.receiptNumber} · ${money(r.amount)}`}
          link={receiptLink(r.token)}
          text={text}
          phone={r.accountPhone}
          onPdf={save}
        />
      )}
    </>
  );
}
