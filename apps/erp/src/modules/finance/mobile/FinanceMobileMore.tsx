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

/* ================================================================== Invoices */

const INV_STATUS: Record<string, { label: string; tone: MTone }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  ISSUED: { label: "Unpaid", tone: "amber" },
  PARTIALLY_PAID: { label: "Part paid", tone: "blue" },
  PAID: { label: "Paid", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "red" },
};
const party = (inv: Invoice) => (inv.invoiceCategory === "TIFFIN" ? inv.customerName || inv.recipientName || "Tiffin customer" : inv.residentName || inv.recipientName || "Resident");

export function InvoicesMobile({
  invoices,
  loading,
  error,
  success,
  onDismiss,
  totals,
  search,
  setSearch,
  status,
  setStatus,
  category,
  setCategory,
  type,
  setType,
  canManage,
  onCreate,
  onView,
  onIssue,
  onAllocate,
  onCancel,
}: {
  invoices: Invoice[];
  loading: boolean;
  error: string | null;
  success: string | null;
  onDismiss: () => void;
  totals: { billed: number; collected: number; due: number };
  search: string;
  setSearch: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  category: "ALL" | "RESIDENT" | "TIFFIN";
  setCategory: (v: "ALL" | "RESIDENT" | "TIFFIN") => void;
  type: string;
  setType: (v: string) => void;
  canManage: boolean;
  onCreate: () => void;
  onView: (inv: Invoice) => void;
  onIssue: (id: string) => void;
  onAllocate: (inv: Invoice) => void;
  onCancel: (id: string) => void;
}) {
  const [open, setOpen] = useState<Invoice | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const act = (fn: () => void) => {
    setOpen(null);
    fn();
  };
  return (
    <MStack>
      {success && <MNotice onClose={onDismiss}>{success}</MNotice>}
      {error && (
        <MNotice tone="red" onClose={onDismiss}>
          {error}
        </MNotice>
      )}
      <MHero
        label="Still to collect"
        value={loading ? "—" : formatMoney(totals.due)}
        items={[
          { label: "Billed", value: loading ? "—" : formatMoney(totals.billed) },
          { label: "Collected", value: loading ? "—" : formatMoney(totals.collected) },
        ]}
        action={
          canManage ? (
            <button type="button" onClick={onCreate} className="m-hero-btn m-press">
              <Plus className="w-4 h-4" /> New
            </button>
          ) : undefined
        }
      />
      <MSegment
        label="For"
        value={category}
        onChange={setCategory}
        options={[
          { value: "ALL", label: "All" },
          { value: "RESIDENT", label: "PG" },
          { value: "TIFFIN", label: "Tiffin" },
        ]}
      />
      <MChips
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: "ALL", label: "All" },
          { value: "ISSUED", label: "Unpaid" },
          { value: "PARTIALLY_PAID", label: "Part paid" },
          { value: "PAID", label: "Paid" },
          { value: "DRAFT", label: "Draft" },
          { value: "CANCELLED", label: "Cancelled" },
        ]}
      />
      <MSearch value={search} onChange={setSearch} placeholder="Search number, name or room" onFilter={() => setFiltersOpen(true)} filterCount={type !== "ALL" ? 1 : 0} />
      {loading ? (
        <MSkeletonRows rows={5} />
      ) : invoices.length === 0 ? (
        <MEmpty icon={FileText} title={search || status !== "ALL" || category !== "ALL" || type !== "ALL" ? "No invoices match" : "No invoices yet"}>
          {canManage && (
            <MButton kind="primary" icon={Plus} onClick={onCreate}>
              New invoice
            </MButton>
          )}
        </MEmpty>
      ) : (
        <MGroup>
          {invoices.map((inv) => {
            const st = INV_STATUS[inv.status] ?? { label: inv.status, tone: "neutral" as MTone };
            return (
              <MRow
                key={inv.id}
                avatar={initials(party(inv))}
                tone={st.tone}
                title={party(inv)}
                sub={[inv.invoiceNumber || "Draft", inv.billingPeriod, inv.roomNumber ? `Room ${inv.roomNumber}` : ""].filter(Boolean).join(" · ")}
                right={formatMoney(inv.balanceDue > 0 ? inv.balanceDue : inv.totalAmount)}
                rightSub={st.label}
                strike={inv.status === "CANCELLED"}
                onClick={() => setOpen(inv)}
                chevron={false}
              />
            );
          })}
        </MGroup>
      )}

      <MSheet
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open ? party(open) : ""}
        footer={
          open ? (
            <MButton kind="primary" icon={Printer} onClick={() => act(() => onView(open))}>
              View bill
            </MButton>
          ) : null
        }
      >
        {open && (
          <>
            <div className="m-card py-1">
              <MField label="Number">{open.invoiceNumber || "Draft"}</MField>
              <MField label="Status">
                <MPill tone={(INV_STATUS[open.status] ?? { tone: "neutral" }).tone as MTone}>{(INV_STATUS[open.status] ?? { label: open.status }).label}</MPill>
              </MField>
              <MField label="For">{open.billingPeriod}</MField>
              <MField label="Due">{open.dueDate}</MField>
              <MField label="Total">{formatMoney(open.totalAmount)}</MField>
              <MField label="Paid" tone="green">{formatMoney(open.amountPaid)}</MField>
              <MField label="Balance" tone={open.balanceDue > 0 ? "red" : undefined}>{formatMoney(open.balanceDue)}</MField>
            </div>
            {canManage && (
              <MGroup>
                {open.status === "DRAFT" && <MRow icon={Send} tone="accent" title="Issue the bill" onClick={() => act(() => onIssue(open.id))} />}
                {(open.status === "ISSUED" || open.status === "PARTIALLY_PAID") && <MRow icon={CreditCard} tone="green" title="Record payment against it" onClick={() => act(() => onAllocate(open))} />}
                {open.amountPaid === 0 && open.status !== "CANCELLED" && <MRow icon={XCircle} tone="red" title="Cancel the bill" onClick={() => act(() => onCancel(open.id))} />}
              </MGroup>
            )}
          </>
        )}
      </MSheet>

      <MSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <MButton kind="primary" onClick={() => setFiltersOpen(false)}>
            Done
          </MButton>
        }
      >
        <p className="m-sheet-label">Kind of bill</p>
        <MChips
          label="Kind of bill"
          value={type}
          onChange={setType}
          options={[
            { value: "ALL", label: "All" },
            { value: "REGULAR_BILL", label: "Regular" },
            { value: "GST_TAX_INVOICE", label: "GST invoice" },
          ]}
        />
      </MSheet>
    </MStack>
  );
}

/** Reason sheet before cancelling a bill. */
export function CancelInvoiceSheet({ open, reason, setReason, busy, onClose, onConfirm }: { open: boolean; reason: string; setReason: (v: string) => void; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <MSheet
      open={open}
      onClose={onClose}
      title="Cancel this bill"
      footer={
        <>
          <MButton kind="soft" onClick={onClose} disabled={busy}>
            Keep it
          </MButton>
          <MButton kind="danger" onClick={onConfirm} disabled={busy || reason.trim().length < 5}>
            {busy ? "Cancelling…" : "Cancel bill"}
          </MButton>
        </>
      }
    >
      <label className="flex flex-col gap-1.5">
        <span className="m-sheet-label">Reason</span>
        <textarea className="m-input !h-auto py-3" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. made twice by mistake" />
      </label>
    </MSheet>
  );
}

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
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 items-center">
        <label className="m-search !pl-3.5">
          <CalendarDays className="w-[18px] h-[18px] shrink-0 text-[#7C877F]" aria-hidden />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
        </label>
        <MPill tone={st === "FINALIZED" ? "green" : st === "REOPENED" ? "amber" : st === "DRAFT" ? "blue" : "neutral"}>
          {st === "FINALIZED" ? (
            <>
              <Lock className="w-3 h-3" /> Closed
            </>
          ) : st === "REOPENED" ? (
            "Reopened"
          ) : st === "DRAFT" ? (
            "Draft saved"
          ) : (
            "Not closed"
          )}
        </MPill>
      </div>
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

      <MHero
        label="Cash that should be in hand"
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
            <span className="m-sheet-label">Cash counted (₹)</span>
            <input className="m-input" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} disabled={isFinalized || !canManage} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="m-sheet-label">Bank checked (₹)</span>
            <input className="m-input" inputMode="decimal" value={bank} onChange={(e) => setBank(e.target.value)} disabled={isFinalized || !canManage} />
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
