"use client";

/**
 * Finance on the phone app, part two: Invoices and Daily closing. The views pass their own state and
 * actions in (InvoiceLedgerView, DailyClosingView), so both layouts do exactly the same things.
 */

import React, { useState } from "react";
import { FileText, Plus, Printer, CreditCard, Send, XCircle, Lock, Unlock, Save, AlertTriangle, CheckCircle2, CalendarDays } from "lucide-react";
import type { DailyClosingPreview, DailyClosingRecord, ClosingDivision, Invoice, PaymentMethod } from "@/types";
import { formatMoney } from "@/lib/format";
import { MButton, MChips, MEmpty, MField, MGroup, MHero, MNotice, MPill, MRow, MSearch, MSection, MSegment, MSheet, MSkeletonRows, MStack, MStats, initials, type MTone } from "@/components/app/m";

/* ================================================================== Daily closing */

const CHANNEL_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank", CHEQUE: "Cheque", OTHER: "Other" } as Record<PaymentMethod, string>;

export function ClosingMobile({
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
  const channels = preview ? (Object.values(preview.channelBreakdown) as Array<{ channel: PaymentMethod; inflow: number; outflow: number; net: number; transactionCount: number }>).filter((c) => c.inflow || c.outflow) : [];
  const dz = preview?.deliverySummary;
  const fig = (v: number | undefined) => (preview ? formatMoney(v ?? 0) : "—");
  return (
    <MStack>
      <div className="flex items-center gap-2.5 min-w-0">
        <label className="m-search m-date-pill">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
        </label>
        <div className="flex-1 min-w-0">
          <MSegment
            label="Part of the business"
            value={division}
            onChange={setDivision}
            options={[
              { value: "COMBINED", label: "All" },
              { value: "PG", label: "PG" },
              { value: "TIFFIN", label: "Tiffin" },
            ]}
          />
        </div>
      </div>

      <MHero
        label="Cash that should be in hand"
        action={
          <span className="m-hero-btn">
            {st === "FINALIZED" ? (
              <>
                <Lock className="w-3.5 h-3.5" /> Closed
              </>
            ) : st === "REOPENED" ? (
              "Reopened"
            ) : st === "DRAFT" ? (
              "Draft saved"
            ) : (
              "Not closed"
            )}
          </span>
        }
        value={loading && !preview ? "—" : fig(preview?.expectedCashBalance)}
        items={[
          { label: "Opening cash", value: fig(preview?.openingCashBalance) },
          { label: "Net today", value: preview ? formatMoney(preview.netMovement, { signed: true }) : "—" },
          { label: "Money in", value: fig(preview?.totalInflow) },
          { label: "Money out", value: fig(preview?.totalOutflow) },
        ]}
      />

      {preview?.hasLateTransactions && (
        <MNotice tone="red">
          {preview.lateTransactionCount} entr{preview.lateTransactionCount === 1 ? "y was" : "ies were"} added after this day was closed ({formatMoney(preview.lateTransactionDelta, { signed: true })}).
        </MNotice>
      )}

      {channels.length > 0 && (
        <MSection title="By payment type">
          <MGroup>
            {channels.map((c) => (
              <MRow
                key={c.channel}
                title={CHANNEL_LABEL[c.channel] ?? c.channel}
                sub={`${c.transactionCount} entr${c.transactionCount === 1 ? "y" : "ies"}${c.outflow ? ` · out ${formatMoney(c.outflow)}` : ""}`}
                right={formatMoney(c.net, { signed: true })}
                rightTone={c.net < 0 ? "red" : c.net > 0 ? "green" : undefined}
              />
            ))}
          </MGroup>
        </MSection>
      )}

      {dz && dz.totalTasks > 0 && (
        <MSection title="Deliveries">
          <MStats
            cols={3}
            items={[
              { label: "Stops", value: dz.totalTasks },
              { label: "Delivered", value: dz.deliveredCount, tone: "green" },
              { label: "Problems", value: dz.exceptionCount, tone: dz.exceptionCount > 0 ? "red" : undefined },
            ]}
          />
        </MSection>
      )}

      <MSection title={isFinalized ? "Closed" : "Count and close"}>
        <div className="m-card space-y-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="m-sheet-label">Cash counted</span>
            <input className="rn-money m-input" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} disabled={isFinalized || !canManage} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="m-sheet-label">Bank checked</span>
            <input className="rn-money m-input" inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} disabled={isFinalized || !canManage} />
          </label>
          <div className={`flex items-center justify-between rounded-2xl px-4 py-3 ${difference === 0 ? "bg-[#E6F2E2] text-[#22521B]" : "bg-[#FBE7E2] text-[#8A2E1D]"}`}>
            <span className="text-[13.5px] font-medium flex items-center gap-2">
              {difference === 0 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {difference === 0 ? "Matches" : difference > 0 ? "More than expected" : "Short"}
            </span>
            <span className="text-[15px] font-semibold tabular-nums">{formatMoney(difference, { signed: true })}</span>
          </div>
          {difference !== 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="m-sheet-label">Why is it different?</span>
              <textarea className="m-input !h-auto py-3" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={isFinalized || !canManage} />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="m-sheet-label">Notes</span>
            <textarea className="m-input !h-auto py-3" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isFinalized || !canManage} />
          </label>
          {!canManage ? (
            <p className="text-[13px] text-[var(--m-ink-3)]">Only the Owner can close the day.</p>
          ) : isFinalized ? (
            <MButton kind="soft" icon={Unlock} onClick={() => setReopenOpen(true)} className="w-full">
              Reopen this day
            </MButton>
          ) : (
            <div className="m-btn-row">
              <MButton kind="soft" icon={Save} onClick={onDraft} disabled={submitting}>
                Save
              </MButton>
              <MButton kind="primary" icon={Lock} onClick={onFinalize} disabled={submitting}>
                Close day
              </MButton>
            </div>
          )}
        </div>
      </MSection>

      <MSection title="Past closings">
        {history.length === 0 ? (
          <MEmpty title="No past closings" />
        ) : (
          <MGroup>
            {history.slice(0, 30).map((c) => (
              <MRow
                key={c.id}
                icon={c.status === "FINALIZED" ? Lock : c.status === "REOPENED" ? Unlock : Save}
                tone={c.status === "FINALIZED" ? "green" : c.status === "REOPENED" ? "amber" : "neutral"}
                title={c.closingDate}
                sub={`${c.division === "COMBINED" ? "PG and Tiffin" : c.division === "PG" ? "PG" : "Tiffin"} · counted ${c.actualCashCounted !== null ? formatMoney(c.actualCashCounted) : "—"}`}
                right={c.cashDiscrepancy === 0 ? "Matched" : formatMoney(c.cashDiscrepancy, { signed: true })}
                rightTone={c.cashDiscrepancy === 0 ? "green" : "red"}
                onClick={() => {
                  setDate(c.closingDate);
                  setDivision(c.division);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                chevron={false}
              />
            ))}
          </MGroup>
        )}
      </MSection>

      <MSheet
        open={reopenOpen}
        onClose={() => {
          setReopenOpen(false);
          setReopenReason("");
        }}
        title={`Reopen ${date}`}
        footer={
          <>
            <MButton
              kind="soft"
              onClick={() => {
                setReopenOpen(false);
                setReopenReason("");
              }}
            >
              Keep closed
            </MButton>
            <MButton kind="danger" icon={Unlock} onClick={onReopen} disabled={submitting || reopenReason.trim().length < 5}>
              Reopen
            </MButton>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="m-sheet-label">Reason</span>
          <textarea className="m-input !h-auto py-3" rows={3} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="e.g. the cash count was wrong" />
        </label>
      </MSheet>
    </MStack>
  );
}
