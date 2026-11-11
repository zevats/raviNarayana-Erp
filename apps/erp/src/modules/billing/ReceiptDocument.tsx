"use client";

import React from "react";
import type { Receipt } from "@/lib/receipts";
import { billDay } from "@/lib/bills";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", CARD: "Card", OTHER: "Other" };

/**
 * A payment receipt, in the same look as the bill: the business with its logo and details, the
 * receipt number and date, who paid, what for, the amount large and in words, how it was paid,
 * and what is still due. Drawn from the stored copy; prints on one A4 page.
 */
export function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  const s = receipt.snapshot;
  const rows: Array<[string, string]> = [
    ["Received from", s.payer.name],
    ...(s.payer.place ? ([["Room", s.payer.place.replace(/^Room /, "")]] as Array<[string, string]>) : []),
    ...(s.payer.phone ? ([["Phone", s.payer.phone]] as Array<[string, string]>) : []),
    ["For", s.detail ? `${s.purpose} · ${s.detail}` : s.purpose],
    ["Paid by", METHOD[s.method || ""] ?? (s.method || "—")],
    ...(s.reference ? ([["Reference", s.reference]] as Array<[string, string]>) : []),
  ];
  return (
    <article className="rn-receipt mx-auto w-full max-w-[760px] bg-white text-[#16241B] text-[13px] leading-[1.45]" aria-label={`Receipt ${receipt.receiptNumber}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-5 sm:px-8 pt-6 sm:pt-8 pb-5 border-b-2 border-[#1E3A2B]">
        <div className="flex items-start gap-3.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-home.png" alt="" width={60} height={60} className="w-[60px] h-[60px] shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-[20px] sm:text-[22px] font-bold leading-tight tracking-[-0.01em] text-[#1E3A2B]">{s.company.name}</p>
            {s.company.address && <p className="mt-1 text-[12.5px] text-[#4A504B] max-w-[330px]">{s.company.address}</p>}
            <p className="mt-0.5 text-[12.5px] text-[#4A504B]">{[s.company.phone ? `Phone ${s.company.phone}` : "", s.company.email].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="inline-block rounded-md bg-[#1E3A2B] px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.14em] text-white">Receipt</p>
          <dl className="mt-2.5 grid grid-cols-[auto_auto] sm:justify-end gap-x-3 gap-y-0.5 text-[12.5px]">
            <dt className="text-[#6B716C]">Receipt no.</dt>
            <dd className="font-semibold tabular-nums">{receipt.receiptNumber}</dd>
            <dt className="text-[#6B716C]">Date</dt>
            <dd className="font-semibold tabular-nums">{billDay(receipt.receiptDate)}</dd>
          </dl>
        </div>
      </div>

      <div className="px-5 sm:px-8 py-6">
        <div className="rounded-2xl bg-[#F2F6EF] px-5 py-5 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#4F6B55]">Amount received</p>
          <p className="mt-1 text-[34px] font-bold tabular-nums leading-tight text-[#1E3A2B]">{money(receipt.amount)}</p>
          <p className="mt-1 text-[13px] font-medium text-[#3A4A3F]">{s.amountInWords}</p>
        </div>
      </div>

      <div className="px-5 sm:px-8">
        <dl className="rounded-xl border border-[#E6E9E3] divide-y divide-[#E6E9E3]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
              <dt className="text-[#6B716C] shrink-0">{k}</dt>
              <dd className="font-semibold text-right break-words min-w-0">{v}</dd>
            </div>
          ))}
          {s.dueAfter !== null && (
            <div className="flex items-start justify-between gap-4 px-4 py-2.5 bg-[#FAFBF8]">
              <dt className="text-[#6B716C] shrink-0">Still due</dt>
              <dd className={`font-bold tabular-nums ${s.dueAfter > 0 ? "text-[#A3311D]" : "text-[#1D4E16]"}`}>{s.dueAfter > 0 ? money(s.dueAfter) : "Nothing due"}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-6 px-5 sm:px-8 pt-5 pb-6 sm:pb-8 border-t border-[#E6E9E3] text-center text-[12px] leading-relaxed text-[#6B716C]">
        <p className="text-[13.5px] font-semibold text-[#1E3A2B]">Thank you</p>
        {s.receivedBy && <p>Received by {s.receivedBy}</p>}
        <p className="mt-1">For {s.company.name} · Computer generated, no signature needed</p>
      </div>
    </article>
  );
}
