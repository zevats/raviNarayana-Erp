"use client";

import React from "react";
import { AlertTriangle, CheckCircle2, Download, Lock, Save, Unlock } from "lucide-react";
import type { ClosingDivision, DailyClosingPreview, DailyClosingRecord, PaymentMethod } from "@/types";
import { formatMoney } from "@/lib/format";
import { Badge, Card, CardHeader, Segmented, StatStrip } from "@/components/ui/kit";
import { Dialog } from "@/components/ui/Dialog";
import { exportClosingsCsv } from "../utils/financeCsv";
import { formatIndianDate } from "../utils/dateUtils";

const CHANNELS: Array<[PaymentMethod, string]> = [
  ["CASH", "Cash"],
  ["UPI", "UPI"],
  ["BANK_TRANSFER", "Bank"],
  ["CHEQUE", "Cheque"],
  ["OTHER", "Other"],
];
const divisionName = (d: ClosingDivision) => (d === "COMBINED" ? "PG and Tiffin" : d === "PG" ? "PG" : "Tiffin");

/**
 * Daily closing on a laptop: the same steps and words as the phone app (the day's figures, by
 * payment type, deliveries, count and close, past closings), laid out for a wide screen.
 */
export function ClosingDesktop({
  date,
  setDate,
  division,
  setDivision,
  preview,
  loading,
  history,
  canManage,
  isFinalized,
  cash,
  setCash,
  bank,
  setBank,
  reason,
  setReason,
  notes,
  setNotes,
  difference,
  submitting,
  onDraft,
  onFinalize,
  onReopen,
  reopenOpen,
  setReopenOpen,
  reopenReason,
  setReopenReason,
}: {
  date: string;
  setDate: (d: string) => void;
  division: ClosingDivision;
  setDivision: (d: ClosingDivision) => void;
  preview: DailyClosingPreview | null;
  loading: boolean;
  history: DailyClosingRecord[];
  canManage: boolean;
  isFinalized: boolean;
  cash: string;
  setCash: (v: string) => void;
  bank: string;
  setBank: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  difference: number;
  submitting: boolean;
  onDraft: () => void;
  onFinalize: () => void;
  onReopen: () => void;
  reopenOpen: boolean;
  setReopenOpen: (v: boolean) => void;
  reopenReason: string;
  setReopenReason: (v: string) => void;
}) {
  const st = preview?.existingClosing?.status;
  const fig = (v: number | undefined, signed = false) => (preview ? formatMoney(v ?? 0, signed ? { signed: true } : undefined) : loading ? "—" : formatMoney(0));
  const dz = preview?.deliverySummary;
  const locked = isFinalized || !canManage;
  const closeReopen = () => {
    setReopenOpen(false);
    setReopenReason("");
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" className="rn-input !w-[160px]" />
        <Segmented
          label="Part of the business"
          size="sm"
          value={division}
          onChange={setDivision}
          options={[
            { value: "COMBINED", label: "All" },
            { value: "PG", label: "PG" },
            { value: "TIFFIN", label: "Tiffin" },
          ]}
        />
        <span className="ml-auto">
          {st === "FINALIZED" ? (
            <Badge tone="good">
              <Lock className="w-3.5 h-3.5" /> Closed
            </Badge>
          ) : st === "REOPENED" ? (
            <Badge tone="warn">Reopened</Badge>
          ) : st === "DRAFT" ? (
            <Badge>Draft saved</Badge>
          ) : (
            <Badge>Not closed</Badge>
          )}
        </span>
      </div>

      {preview?.hasLateTransactions && (
        <p role="alert" className="rn-notice rn-notice-bad flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {preview.lateTransactionCount} entr{preview.lateTransactionCount === 1 ? "y was" : "ies were"} added after this day was closed ({formatMoney(preview.lateTransactionDelta, { signed: true })}).
        </p>
      )}

      <StatStrip
        items={[
          { label: "Cash expected in hand", value: fig(preview?.expectedCashBalance) },
          { label: "Opening cash", value: fig(preview?.openingCashBalance) },
          { label: "Money in", value: fig(preview?.totalInflow), tone: "good" },
          { label: "Money out", value: fig(preview?.totalOutflow), tone: (preview?.totalOutflow ?? 0) > 0 ? "bad" : "default" },
          { label: "Net today", value: fig(preview?.netMovement, true) },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start">
        <Card flush className="overflow-hidden">
          <CardHeader title="By payment type" className="px-5 pt-5 pb-3" />
          <div className="overflow-x-auto">
          <table className="rn-close-table w-full">
            <thead>
              <tr>
                <th>Paid by</th>
                <th className="!text-right">Money in</th>
                <th className="!text-right">Money out</th>
                <th className="!text-right">Net</th>
                <th className="!text-right">Entries</th>
              </tr>
            </thead>
            <tbody>
              {CHANNELS.map(([key, name]) => {
                const c = preview?.channelBreakdown?.[key];
                return (
                  <tr key={key}>
                    <td className="font-medium text-[var(--rn-ink)]">{name}</td>
                    <td className="!text-right">{fig(c?.inflow)}</td>
                    <td className="!text-right">{fig(c?.outflow)}</td>
                    <td className={`!text-right font-semibold ${(c?.net ?? 0) < 0 ? "text-[#9A3423]" : (c?.net ?? 0) > 0 ? "text-[#2F6B24]" : ""}`}>{fig(c?.net, (c?.net ?? 0) !== 0)}</td>
                    <td className="!text-right text-[var(--rn-ink-2)]">{preview ? c?.transactionCount ?? 0 : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Deliveries" />
          <dl className="mt-3 divide-y divide-[var(--rn-line)] text-[14px]">
            {[
              ["Stops", dz?.totalTasks],
              ["Delivered", dz?.deliveredCount],
              ["Problems", dz?.exceptionCount],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between py-2.5">
                <dt className="text-[var(--rn-ink-2)]">{k}</dt>
                <dd className={`font-semibold tabular-nums ${k === "Problems" && Number(v) > 0 ? "text-[#9A3423]" : "text-[var(--rn-ink)]"}`}>{preview ? v ?? 0 : "—"}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card>
        <CardHeader title={isFinalized ? "Closed" : "Count and close"} />
        <div className="mt-4 grid gap-4 md:grid-cols-3 items-end">
          <label className="flex flex-col gap-1.5">
            <span className="rn-label">Cash counted</span>
            <input className="rn-money rn-input" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} disabled={locked} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="rn-label">Bank checked</span>
            <input className="rn-money rn-input" inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} disabled={locked} />
          </label>
          <div className={`flex items-center justify-between rounded-full h-11 px-5 ${difference === 0 ? "bg-[#E6F2E2] text-[#22521B]" : "bg-[#FBE7E2] text-[#8A2E1D]"}`}>
            <span className="text-[13.5px] font-medium flex items-center gap-2">
              {difference === 0 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {difference === 0 ? "Matches" : difference > 0 ? "More than expected" : "Short"}
            </span>
            <span className="text-[15px] font-semibold tabular-nums">{formatMoney(difference, { signed: true })}</span>
          </div>
        </div>
        <div className={`mt-4 grid gap-4 ${difference !== 0 ? "md:grid-cols-2" : ""}`}>
          {difference !== 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="rn-label">Why is it different?</span>
              <textarea className="rn-input !h-auto !rounded-2xl py-3" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={locked} />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="rn-label">Notes</span>
            <textarea className="rn-input !h-auto !rounded-2xl py-3" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--rn-ink-2)] min-w-0">
            {preview?.existingClosing?.finalizedByName && preview.existingClosing.finalizedAt
              ? `Closed by ${preview.existingClosing.finalizedByName} · ${new Date(preview.existingClosing.finalizedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`
              : preview?.existingClosing?.reopenedByName
                ? `Reopened by ${preview.existingClosing.reopenedByName}${preview.existingClosing.reopenReason ? `: ${preview.existingClosing.reopenReason}` : ""}`
                : !canManage
                  ? "Only the Owner can close the day."
                  : ""}
          </p>
          {canManage && (
            <div className="flex items-center gap-2.5">
              {isFinalized ? (
                <button type="button" className="rn-btn" onClick={() => setReopenOpen(true)}>
                  <Unlock /> Reopen this day
                </button>
              ) : (
                <>
                  <button type="button" className="rn-btn" onClick={onDraft} disabled={submitting}>
                    <Save /> Save
                  </button>
                  <button type="button" className="rn-btn rn-btn-primary" onClick={onFinalize} disabled={submitting}>
                    <Lock /> Close day
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card flush className="overflow-hidden">
        <CardHeader
          title="Past closings"
          className="px-5 pt-5 pb-3"
          action={
            <button type="button" className="rn-btn rn-btn-sm" disabled={history.length === 0} onClick={() => void exportClosingsCsv(history)} aria-label="Download past closings as CSV">
              <Download /> CSV
            </button>
          }
        />
        {history.length === 0 ? (
          <p className="px-5 pb-6 pt-2 text-center text-[14px] text-[var(--rn-ink-2)]">No past closings</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="rn-close-table w-full">
            <thead>
              <tr>
                <th>Day</th>
                <th>For</th>
                <th className="!text-right">Expected</th>
                <th className="!text-right">Counted</th>
                <th className="!text-right">Difference</th>
                <th>Status</th>
                <th>Closed by</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 60).map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setDate(c.closingDate);
                    setDivision(c.division);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <td className="font-medium text-[var(--rn-ink)]">{formatIndianDate(c.closingDate)}</td>
                  <td className="text-[var(--rn-ink-2)]">{divisionName(c.division)}</td>
                  <td className="!text-right">{formatMoney(c.expectedCashBalance)}</td>
                  <td className="!text-right">{c.actualCashCounted !== null ? formatMoney(c.actualCashCounted) : "—"}</td>
                  <td className={`!text-right font-semibold ${c.cashDiscrepancy === 0 ? "text-[#2F6B24]" : "text-[#9A3423]"}`}>{c.cashDiscrepancy === 0 ? "Matched" : formatMoney(c.cashDiscrepancy, { signed: true })}</td>
                  <td>{c.status === "FINALIZED" ? <Badge tone="good">Closed</Badge> : c.status === "REOPENED" ? <Badge tone="warn">Reopened</Badge> : <Badge>Draft</Badge>}</td>
                  <td className="text-[var(--rn-ink-2)]">{c.finalizedByName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <Dialog
        open={reopenOpen}
        onClose={closeReopen}
        title={`Reopen ${formatIndianDate(date)}`}
        size="sm"
        busy={submitting}
        footer={
          <>
            <button type="button" className="rn-btn" onClick={closeReopen}>
              Keep closed
            </button>
            <button type="button" className="rn-btn rn-btn-danger" onClick={onReopen} disabled={submitting || reopenReason.trim().length < 5}>
              <Unlock /> Reopen
            </button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="rn-label">Why is it being reopened?</span>
          <textarea className="rn-input !h-auto !rounded-2xl py-3" rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
        </label>
      </Dialog>
    </div>
  );
}
