"use client";

import React, { useEffect, useRef, useState } from "react";
import { CreditCard, Wallet, TrendingDown, Download, MoreHorizontal } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { RefreshButton } from "@/components/ui/states";

interface FinanceHeaderProps {
  /** Current section, as named in the sidebar (Cashbook, Resident dues, Invoices, Daily closing). */
  title: string;
  onRefresh: () => void;
  isLoading: boolean;
  onOpenPayment: () => void;
  /** Cashbook only: the entry actions. Dues, Bills and Daily closing show the title alone. */
  showActions?: boolean;
  onOpenDeposit: () => void;
  onOpenExpense: () => void;
  onExport: () => void;
  canExport: boolean;
}

/**
 * Finance actions. Wide screens show every action; phones show the main one (Record payment) and a
 * "More" menu for the rest, so the header stays one tidy line.
 */
export function FinanceHeader({
  title,
  onRefresh,
  isLoading,
  onOpenPayment,
  showActions = true,
  onOpenDeposit,
  onOpenExpense,
  onExport,
  canExport,
}: FinanceHeaderProps) {
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more) return;
    const away = (e: Event) => box.current && !box.current.contains(e.target as Node) && setMore(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("touchstart", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("touchstart", away);
      window.removeEventListener("keydown", esc);
    };
  }, [more]);

  const secondary: Array<{ key: string; label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }> = [
    { key: "deposit", label: "Deposit", icon: <Wallet />, onClick: onOpenDeposit },
    { key: "expense", label: "Expense", icon: <TrendingDown />, onClick: onOpenExpense },
  ];

  if (!showActions) return <PageHeader title={title} />;
  return (
    <PageHeader
      title={title}
      actions={
        <>
          <RefreshButton onRefresh={onRefresh} busy={isLoading} label="Refresh financial records" />
          <button type="button" onClick={onExport} disabled={!canExport || isLoading} className="rn-btn rn-btn-icon max-sm:!hidden" title="Export the cashbook (CSV)" aria-label="Export the cashbook as CSV">
            <Download />
          </button>
          {secondary.map((a) => (
            <button key={a.key} type="button" onClick={a.onClick} className="rn-btn max-sm:!hidden">
              {a.icon} {a.label}
            </button>
          ))}
          {/* Phones: the other actions in one menu */}
          <div ref={box} className="relative sm:hidden">
            <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu" className="rn-btn">
              <MoreHorizontal /> More
            </button>
            {more && (
              <div role="menu" className="rn-pop absolute left-0 top-full mt-2 z-50 w-56 rounded-2xl p-1.5">
                {[...secondary, { key: "export", label: "Export (CSV)", icon: <Download />, onClick: onExport, disabled: !canExport || isLoading }].map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="menuitem"
                    disabled={a.disabled}
                    onClick={() => {
                      setMore(false);
                      a.onClick();
                    }}
                    className="w-full min-h-[44px] px-3 rounded-xl flex items-center gap-2.5 text-left text-[14px] text-[var(--rn-ink)] hover:bg-[var(--rn-accent-tint)] disabled:opacity-50 [&>svg]:w-4 [&>svg]:h-4"
                  >
                    {a.icon}
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={onOpenPayment} className="rn-btn rn-btn-primary">
            <CreditCard /> Receive
          </button>
        </>
      }
    />
  );
}
