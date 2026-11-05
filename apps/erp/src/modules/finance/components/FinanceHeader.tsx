"use client";

import React from "react";
import { CreditCard, Receipt, Wallet, TrendingDown, RefreshCw, Download, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { RefreshButton } from "@/components/ui/states";

interface FinanceHeaderProps {
  /** Current section, as named in the sidebar (Cashbook, Resident dues, Invoices, Daily closing). */
  title: string;
  onRefresh: () => void;
  isLoading: boolean;
  onOpenPayment: () => void;
  onOpenCharge: () => void;
  /** Monthly rent for everyone (preview, then charge). */
  onOpenRentRun?: () => void;
  onOpenDeposit: () => void;
  onOpenExpense: () => void;
  onExport: () => void;
  canExport: boolean;
}

export function FinanceHeader({
  title,
  onRefresh,
  isLoading,
  onOpenPayment,
  onOpenCharge,
  onOpenRentRun,
  onOpenDeposit,
  onOpenExpense,
  onExport,
  canExport,
}: FinanceHeaderProps) {
  return (
    <PageHeader
      title={title}
      actions={
        <>
          <RefreshButton onRefresh={onRefresh} busy={isLoading} label="Refresh financial records" />
          <button type="button" onClick={onExport} disabled={!canExport || isLoading} className="rn-btn rn-btn-icon" title="Export the cashbook (CSV)" aria-label="Export the cashbook as CSV">
            <Download />
          </button>
          {onOpenRentRun && (
            <button type="button" onClick={onOpenRentRun} className="rn-btn">
              <CalendarClock /> Monthly rent
            </button>
          )}
          <button type="button" onClick={onOpenCharge} className="rn-btn">
            <Receipt /> Rent charge
          </button>
          <button type="button" onClick={onOpenDeposit} className="rn-btn">
            <Wallet /> Deposit
          </button>
          <button type="button" onClick={onOpenExpense} className="rn-btn">
            <TrendingDown /> Expense
          </button>
          <button type="button" onClick={onOpenPayment} className="rn-btn rn-btn-primary">
            <CreditCard /> Record payment
          </button>
        </>
      }
    />
  );
}
