"use client";

import React from "react";
import { CashbookSummary } from "@/types";
import { formatINR } from "../utils/formatUtils";

interface FinancialSummaryCardsProps {
  summary: CashbookSummary | null;
  isLoading: boolean;
}

export function FinancialSummaryCards({ summary, isLoading }: FinancialSummaryCardsProps) {
  const rentCollected = summary?.totalRentCollected ?? 0;
  const depositsHeld = summary?.totalDepositsCollected ?? 0;
  const expensesPaid = summary?.totalExpensesPaid ?? 0;
  const netCashMovement = summary?.netCashMovement ?? 0;
  const outstandingRent = summary?.totalOutstandingRent ?? 0;

  const isNetPositive = netCashMovement >= 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
      {/* 1. Rent Collected */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
          Rent Collected
        </span>
        <div className="mt-2">
          {isLoading ? (
            <div className="h-8 w-28 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
              {formatINR(rentCollected)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
          Period collections
        </span>
      </div>

      {/* 2. Deposits Held */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
          Deposits Held
        </span>
        <div className="mt-2">
          {isLoading ? (
            <div className="h-8 w-24 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
              {formatINR(depositsHeld)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
          Refundable liability (period)
        </span>
      </div>

      {/* 3. Expenses Paid */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
          Expenses Paid
        </span>
        <div className="mt-2">
          {isLoading ? (
            <div className="h-8 w-24 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
              {formatINR(expensesPaid)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
          Operational disbursements
        </span>
      </div>

      {/* 4. Net Cash Movement */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
          Net Cash Movement
        </span>
        <div className="mt-2">
          {isLoading ? (
            <div className="h-8 w-28 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
              {isNetPositive ? "+" : "-"}{formatINR(Math.abs(netCashMovement))}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
          (Rent + Deposits) - Expenses
        </span>
      </div>

      {/* 5. Outstanding Rent */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0 col-span-2 sm:col-span-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
          Outstanding Rent
        </span>
        <div className="mt-2">
          {isLoading ? (
            <div className="h-8 w-24 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
              {formatINR(outstandingRent)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
          All-time balance across residents
        </span>
      </div>
    </div>
  );
}
