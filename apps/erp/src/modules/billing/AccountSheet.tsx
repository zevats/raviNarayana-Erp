"use client";

import React, { useEffect, useState } from "react";
import { ReceiptText, Wallet } from "lucide-react";
import type { Bill, BillSummary } from "@/lib/bills";
import { billDay } from "@/lib/bills";
import { Dialog } from "@/components/ui/Dialog";
import { Segmented } from "@/components/ui/kit";
import { LoadError } from "@/components/ui/states";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { AccountDues, DueLine, HistoryEntry, getJson, listAccountBills, methodLabel, money } from "./api";
import { BillRow, GenerateBillDialog, ReceivePaymentDialog } from "./BillDialogs";
import { BillViewer } from "./BillViewer";

const TAGS = ["finance", "receivables", "delivery", "tiffin", "bills"];

/** What a due is, in words: the rent month, the plan month, the order. */
export function dueTitle(l: DueLine): string {
  if (l.source === "PG") return l.reference && l.reference !== "Rent charge" ? `Rent · ${l.reference}` : "Rent";
  if (l.source === "TIFFIN") return l.kind === "UNALLOCATED" ? "Paid ahead" : l.description.startsWith("Monthly plan") ? "Monthly plan" : l.description;
  if (l.kind === "ADVANCE") return "Advance paid";
  return `${l.reference.startsWith("Dine in") ? "" : "Order · "}${l.reference.split(" · ").slice(0, l.reference.startsWith("Dine in") ? 2 : 1).join(" · ")}`;
}

/**
 * One person's dues, the same for a tiffin customer and a PG resident: what is due, two actions
 * (Generate bill, Receive payment), the dues line by line, the bills made and the history.
 * `preview` shows the name and amount from the list at once while the rest loads.
 */
export function AccountSheet({ accountKey, preview, onClose }: { accountKey: string | null; preview?: { name: string; total: number } | null; onClose: () => void }) {
  const canRecord = useHasPermission("finance.record");
  const [tab, setTab] = useState<"dues" | "bills" | "history">("dues");
  const [billing, setBilling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [viewing, setViewing] = useState<{ bill?: Bill; id?: string } | null>(null);
  const [fresh, setFresh] = useState<AccountDues | null>(null);

  useEffect(() => {
    setTab("dues");
    setFresh(null);
    setBilling(false);
    setPaying(false);
    setViewing(null);
  }, [accountKey]);

  const url = accountKey ? `/api/finance/receivables/account?key=${encodeURIComponent(accountKey)}` : null;
  const acc = useErpQuery<AccountDues>(url, () => getJson<AccountDues>(url!), { tags: TAGS, ttl: 5000 });
  const billsQ = useErpQuery<{ bills: BillSummary[]; total: number }>(accountKey ? `bills:account:${accountKey}` : null, () => listAccountBills(accountKey!), { tags: ["bills"], ttl: 15000 });
  const historyUrl = accountKey && tab === "history" ? `/api/finance/receivables/statement?key=${encodeURIComponent(accountKey)}` : null;
  const historyQ = useErpQuery<{ statement: { entries: HistoryEntry[] } }>(historyUrl, () => getJson(historyUrl!), { tags: TAGS, ttl: 5000 });
  useEffect(() => {
    setFresh(null);
  }, [acc.data]);

  const a = fresh && fresh.account.accountKey === accountKey ? fresh : acc.data && acc.data.account.accountKey === accountKey ? acc.data : null;
  const name = a?.account.name ?? preview?.name ?? "Dues";
  const due = a ? a.totals.total : preview?.total ?? 0;
  const bills = billsQ.data?.bills ?? [];
  const parts = a
    ? [
        { label: "Rent", value: a.totals.PG },
        { label: "Monthly plan", value: a.totals.TIFFIN },
        { label: "Orders", value: a.totals.DELIVERY },
      ].filter((p) => p.value !== 0)
    : [];
  const history = [...(historyQ.data?.statement.entries ?? [])].reverse();

  return (
    <>
      <Dialog
        open={Boolean(accountKey)}
        onClose={onClose}
        title={name}
        description={a ? [a.account.place, a.account.phone].filter(Boolean).join(" · ") || undefined : undefined}
        size="md"
      >
        <div className="space-y-4 min-w-0">
          <div className="rounded-[22px] bg-[var(--rn-accent)] text-white px-5 py-4">
            <p className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-white/75">Due</p>
            <p className="mt-0.5 text-[32px] font-bold leading-none tabular-nums" data-testid="account-due">{a || preview ? money(due) : "—"}</p>
            {parts.length > 1 && (
              <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-white/90">
                {parts.map((p) => (
                  <span key={p.label}>
                    {p.label} <span className="font-semibold tabular-nums">{money(p.value)}</span>
                  </span>
                ))}
              </p>
            )}
          </div>

          {canRecord && (
            <div className="grid grid-cols-2 gap-2.5">
              <button type="button" className="rn-btn h-12" disabled={!a || due <= 0} onClick={() => setBilling(true)}>
                <ReceiptText /> Generate bill
              </button>
              <button type="button" className="rn-btn rn-btn-primary h-12" disabled={!a || due <= 0} onClick={() => setPaying(true)}>
                <Wallet /> Receive payment
              </button>
            </div>
          )}

          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            className="w-full"
            options={[
              { value: "dues", label: "Dues", count: a ? a.lines.filter((l) => l.outstanding > 0).length : undefined },
              { value: "bills", label: "Bills", count: billsQ.data ? billsQ.data.total : undefined },
              { value: "history", label: "History" },
            ]}
          />

          {tab === "dues" ? (
            !a ? (
              acc.error ? (
                <LoadError message={acc.error.message} onRetry={() => acc.refetch()} />
              ) : (
                <Rows />
              )
            ) : a.lines.length === 0 ? (
              <Empty>Nothing due</Empty>
            ) : (
              <ul className="rn-due-list" aria-label="Dues">
                {a.lines.map((l) => (
                  <li key={`${l.source}:${l.kind}:${l.refId}`} className="rn-due-row is-static">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-[var(--rn-ink)] truncate">{dueTitle(l)}</span>
                      <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate tabular-nums">
                        {billDay(l.date)}
                        {l.outstanding > 0 && l.ageDays > 0 ? ` · ${l.ageDays} day${l.ageDays === 1 ? "" : "s"}` : ""}
                        {l.paid > 0 ? ` · paid ${money(l.paid)} of ${money(l.amount)}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[15px] font-semibold tabular-nums ${l.outstanding < 0 ? "text-[#2F6B24]" : "text-[var(--rn-ink)]"}`}>
                      {l.outstanding < 0 ? `−${money(-l.outstanding)}` : money(l.outstanding)}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : tab === "bills" ? (
            !billsQ.data ? (
              billsQ.error ? (
                <LoadError message={billsQ.error.message} onRetry={() => billsQ.refetch()} />
              ) : (
                <Rows />
              )
            ) : bills.length === 0 ? (
              <Empty>No bills yet</Empty>
            ) : (
              <ul className="rn-due-list" aria-label="Bills">
                {bills.map((b) => (
                  <li key={b.id}>
                    <BillRow bill={b} showName={false} onOpen={() => setViewing({ id: b.id })} />
                  </li>
                ))}
              </ul>
            )
          ) : !historyQ.data ? (
            historyQ.error ? (
              <LoadError message={historyQ.error.message} onRetry={() => historyQ.refetch()} />
            ) : (
              <Rows />
            )
          ) : history.length === 0 ? (
            <Empty>No history yet</Empty>
          ) : (
            <ol className="rn-due-list" aria-label="History">
              {history.map((e, i) => {
                const change = e.charge - e.payment + e.adjustment;
                return (
                  <li key={i} className="rn-due-row is-static">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-[var(--rn-ink)] truncate">
                        {e.type}
                        {e.reversedLater ? " (reversed)" : ""}
                      </span>
                      <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate tabular-nums">
                        {billDay(e.date)}
                        {e.method ? ` · ${methodLabel(e.method)}` : ""}
                        {e.reference ? ` · ${e.reference}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block text-[15px] font-semibold tabular-nums ${change < 0 ? "text-[#2F6B24]" : "text-[var(--rn-ink)]"}`}>{change < 0 ? `−${money(-change)}` : `+${money(change)}`}</span>
                      <span className="block text-[12px] text-[var(--rn-ink-3)] tabular-nums">due {money(e.balance)}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </Dialog>

      {accountKey && (
        <>
          <GenerateBillDialog
            open={billing}
            onClose={() => setBilling(false)}
            accountKey={accountKey}
            name={name}
            due={due}
            onMade={(bill) => {
              setBilling(false);
              invalidateErpCache(["bills"]);
              setViewing({ bill });
            }}
          />
          <ReceivePaymentDialog
            open={paying}
            onClose={() => setPaying(false)}
            accountKey={accountKey}
            name={name}
            due={due}
            bills={bills}
            onDone={(account) => {
              setPaying(false);
              if (account) setFresh(account);
            }}
          />
        </>
      )}
      <BillViewer bill={viewing?.bill} billId={viewing?.id} onClose={() => setViewing(null)} />
    </>
  );
}

const Rows = () => (
  <div className="space-y-2" aria-busy="true">
    {Array.from({ length: 3 }).map((_, i) => (
      <span key={i} className="rn-skel block h-14 w-full rounded-2xl" />
    ))}
  </div>
);
const Empty = ({ children }: { children: React.ReactNode }) => <p className="rounded-2xl border border-dashed border-[var(--rn-line)] px-4 py-8 text-center text-[14.5px] text-[var(--rn-ink-2)]">{children}</p>;
