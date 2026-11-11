"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Bill } from "@/lib/bills";
import { billDay } from "@/lib/bills";

const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const paise = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", CARD: "Card", OTHER: "Other" };

/**
 * The bill itself, as the customer sees it: the business with its logo and details, who it is for,
 * every due line by line, the tax inside the total on a GST bill, the amount in words, the latest
 * payments and a UPI code to pay. Drawn from the stored copy, so it always reads as it was issued.
 * Used in the app (bill pop-up) and on the page behind a share link; it prints on one A4 page.
 */
export function BillDocument({ bill }: { bill: Bill }) {
  const s = bill.snapshot;
  const gst = bill.type === "GST";
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!s.company.upiId) return;
    let live = true;
    const p = new URLSearchParams({ pa: s.company.upiId, pn: s.company.upiName || s.company.name, cu: "INR", am: String(Math.round(bill.total)), tn: `Bill ${bill.billNumber}` });
    QRCode.toString(`upi://pay?${p.toString().replace(/\+/g, "%20")}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#16241B", light: "#FFFFFF" } })
      .then((svg) => live && setQr(svg))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [s.company.upiId, s.company.upiName, s.company.name, bill.total, bill.billNumber]);

  const showPaid = s.lines.some((l) => l.paid > 0 || l.due < 0);
  return (
    <article className="rn-bill mx-auto w-full max-w-[760px] bg-white text-[#16241B] text-[13px] leading-[1.45]" aria-label={`Bill ${bill.billNumber}`}>
      {/* Business and bill number */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-5 sm:px-8 pt-6 sm:pt-8 pb-5 border-b-2 border-[#1E3A2B]">
        <div className="flex items-start gap-3.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-home.png" alt="" width={60} height={60} className="w-[60px] h-[60px] shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="text-[20px] sm:text-[22px] font-bold leading-tight tracking-[-0.01em] text-[#1E3A2B]">{s.company.name}</p>
            {s.company.address && <p className="mt-1 text-[12.5px] text-[#4A504B] max-w-[330px]">{s.company.address}</p>}
            <p className="mt-0.5 text-[12.5px] text-[#4A504B]">{[s.company.phone ? `Phone ${s.company.phone}` : "", s.company.email].filter(Boolean).join(" · ")}</p>
            {gst && s.company.gstin && (
              <p className="mt-1 text-[12.5px] font-semibold tabular-nums">
                GSTIN {s.company.gstin}
              </p>
            )}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="inline-block rounded-md bg-[#1E3A2B] px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[0.14em] text-white">{gst ? "Tax invoice" : "Bill"}</p>
          <dl className="mt-2.5 grid grid-cols-[auto_auto] sm:justify-end gap-x-3 gap-y-0.5 text-[12.5px]">
            <dt className="text-[#6B716C]">Bill no.</dt>
            <dd className="font-semibold tabular-nums">{bill.billNumber}</dd>
            <dt className="text-[#6B716C]">Date</dt>
            <dd className="font-semibold tabular-nums">{billDay(bill.issueDate)}</dd>
          </dl>
        </div>
      </div>

      {/* Who it is for, and the amount */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 px-5 sm:px-8 py-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B716C]">Bill to</p>
          <p className="mt-1 text-[16px] font-semibold break-words">{s.recipient.name}</p>
          <p className="text-[12.5px] text-[#4A504B] break-words">{[s.recipient.place, s.recipient.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="rounded-xl bg-[#F2F6EF] px-4 py-3 sm:min-w-[190px] sm:text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#4F6B55]">Amount due</p>
          <p className="mt-0.5 text-[24px] font-bold tabular-nums leading-tight text-[#1E3A2B]">{money(bill.total)}</p>
        </div>
      </div>

      {/* Dues, line by line */}
      <div className="px-5 sm:px-8">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-[#1E3A2B] text-white text-left">
              <th className="w-8 py-2 pl-3 pr-1 font-semibold rounded-l-md">#</th>
              <th className="py-2 px-2 font-semibold">Particulars</th>
              <th className="py-2 px-2 font-semibold whitespace-nowrap hidden min-[480px]:table-cell print:table-cell">Date</th>
              {showPaid && <th className="py-2 px-2 font-semibold text-right whitespace-nowrap hidden min-[480px]:table-cell print:table-cell">Amount</th>}
              {showPaid && <th className="py-2 px-2 font-semibold text-right whitespace-nowrap hidden min-[480px]:table-cell print:table-cell">Paid</th>}
              <th className="py-2 pl-2 pr-3 font-semibold text-right rounded-r-md">Due</th>
            </tr>
          </thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#E6E9E3] align-top">
                <td className="py-2.5 pl-3 pr-1 tabular-nums text-[#6B716C]">{i + 1}</td>
                <td className="py-2.5 px-2 min-w-0">
                  <span className="block font-semibold break-words">{l.label}</span>
                  {l.detail && <span className="block text-[12px] text-[#4A504B] break-words">{l.detail}</span>}
                  <span className="block text-[12px] text-[#6B716C] min-[480px]:hidden print:hidden">
                    {billDay(l.date)}
                    {l.paid > 0 ? ` · paid ${money(l.paid)} of ${money(l.amount)}` : ""}
                  </span>
                </td>
                <td className="py-2.5 px-2 tabular-nums whitespace-nowrap hidden min-[480px]:table-cell print:table-cell">{billDay(l.date)}</td>
                {showPaid && <td className="py-2.5 px-2 text-right tabular-nums hidden min-[480px]:table-cell print:table-cell">{l.due < 0 ? "" : money(l.amount)}</td>}
                {showPaid && <td className="py-2.5 px-2 text-right tabular-nums hidden min-[480px]:table-cell print:table-cell">{l.paid > 0 ? money(l.paid) : ""}</td>}
                <td className="py-2.5 pl-2 pr-3 text-right tabular-nums font-semibold whitespace-nowrap">{l.due < 0 ? `−${money(-l.due)}` : money(l.due)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals and payment */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-5 px-5 sm:px-8 py-5">
        <div className="min-w-0 space-y-4 order-2 sm:order-1">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B716C]">Amount in words</p>
            <p className="mt-0.5 font-medium">{s.amountInWords}</p>
          </div>
          {qr && (
            <div className="flex items-center gap-3">
              <span className="block w-[96px] h-[96px] shrink-0 rounded-lg border border-[#E6E9E3] p-1.5 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} aria-label="UPI payment code" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B716C]">Pay by UPI</p>
                <p className="mt-0.5 font-semibold break-all">{s.company.upiId}</p>
                <p className="text-[12px] text-[#4A504B]">Scan with any UPI app</p>
              </div>
            </div>
          )}
        </div>
        <dl className="order-1 sm:order-2 sm:min-w-[250px] text-[13px]">
          {gst && (
            <>
              <div className="flex justify-between gap-6 py-1">
                <dt className="text-[#4A504B]">Taxable value</dt>
                <dd className="tabular-nums">{paise(bill.taxable)}</dd>
              </div>
              <div className="flex justify-between gap-6 py-1">
                <dt className="text-[#4A504B]">CGST {bill.gstRate / 2}%</dt>
                <dd className="tabular-nums">{paise(bill.cgst)}</dd>
              </div>
              <div className="flex justify-between gap-6 py-1">
                <dt className="text-[#4A504B]">SGST {bill.gstRate / 2}%</dt>
                <dd className="tabular-nums">{paise(bill.sgst)}</dd>
              </div>
            </>
          )}
          <div className="mt-1 flex justify-between gap-6 border-t-2 border-[#1E3A2B] pt-2.5 text-[16px] font-bold">
            <dt>Total due</dt>
            <dd className="tabular-nums">{money(bill.total)}</dd>
          </div>
          {gst && <p className="mt-1 text-[11.5px] text-[#6B716C] sm:text-right">GST is included in the total</p>}
        </dl>
      </div>

      {/* Payments so far */}
      {s.payments.length > 0 && (
        <div className="px-5 sm:px-8 pb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6B716C]">Recent payments received</p>
          <ul className="mt-1.5 rounded-lg border border-[#E6E9E3] divide-y divide-[#E6E9E3]">
            {s.payments.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-3 py-1.5 text-[12.5px]">
                <span className="min-w-0 truncate">
                  <span className="tabular-nums">{billDay(p.date)}</span>
                  {p.method ? ` · ${METHOD[p.method] ?? p.method}` : ""}
                </span>
                <span className="shrink-0 tabular-nums font-semibold">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4 px-5 sm:px-8 pt-4 pb-6 sm:pb-8 border-t border-[#E6E9E3] text-[12px] text-[#6B716C]">
        <p>Thank you. Dues are payable on receipt of this bill.</p>
        <p className="text-right">
          For {s.company.name}
          <span className="block mt-0.5">Computer generated, no signature needed</span>
        </p>
      </div>
    </article>
  );
}
