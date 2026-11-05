"use client";

import React from "react";
import { CashbookSummary } from "@/types";
import { formatINR } from "../utils/formatUtils";
import { formatMoney } from "@/lib/format";
import { StatStrip } from "@/components/ui/kit";

interface FinancialSummaryCardsProps {
  summary: CashbookSummary | null;
  isLoading: boolean;
}

/**
 * Period figures for the cashbook, as one strip. Definitions: docs/FINANCIAL_DEFINITIONS.md.
 * Refunds of money received in an earlier period are shown on their own line under the receipts,
 * and the net can be negative (decision D9), so a month never shows ₹0 for money that went out.
 */
export function FinancialSummaryCards({ summary, isLoading }: FinancialSummaryCardsProps) {
  const b = summary?.breakdown;
  const net = summary?.netCashMovementExact ?? summary?.netCashMovement ?? 0;
  const rentReceipts = b ? b.rentReceipts : summary?.totalRentCollected ?? 0;
  const rentRefunds = b?.rentRefunds ?? 0;
  const expenses = b ? b.expensesPaid : summary?.totalExpensesPaid ?? 0;
  const expenseRefunds = b?.expenseRefunds ?? 0;
  const value = (v: React.ReactNode) => (isLoading ? <span className="inline-block h-6 w-20 rounded-md bg-black/[0.05] animate-pulse align-middle" /> : v);

  return (
    <StatStrip
      items={[
        {
          label: "Rent collected",
          value: value(formatINR(rentReceipts)),
          note: rentRefunds > 0 ? `refunds ${formatMoney(-rentRefunds)} · net ${formatMoney(rentReceipts - rentRefunds)}` : "this period",
        },
        { label: "Deposits held", value: value(formatINR(summary?.totalDepositsCollected ?? 0)), note: "refundable" },
        {
          label: "Expenses paid",
          value: value(formatINR(expenses)),
          note: expenseRefunds > 0 ? `refunded ${formatMoney(-expenseRefunds)} · net ${formatMoney(expenses - expenseRefunds)}` : "this period",
        },
        {
          label: "Net cash movement",
          value: value(net === 0 ? formatMoney(0) : formatMoney(net, { signed: true })),
          note: "rent + deposits − expenses",
          tone: isLoading ? "default" : net >= 0 ? "good" : "bad",
        },
        { label: "Rent owed", value: value(formatINR(summary?.totalOutstandingRent ?? 0)), note: "all residents, to date", tone: (summary?.totalOutstandingRent ?? 0) > 0 ? "warn" : "default" },
      ]}
    />
  );
}
