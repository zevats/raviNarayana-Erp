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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5 sm:gap-4 min-w-0">
      {/* 1. Rent Collected */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0 min-h-[120px]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] leading-snug">
          Rent Collected
        </span>
        <div className="my-1.5">
          {isLoading ? (
            <div className="h-8 w-28 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#1A2E20] font-sans tabular-nums whitespace-nowrap block">
              {formatINR(rentCollected)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] block font-normal leading-tight">
          Period collections
        </span>
      </div>

      {/* 2. Deposits Held */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0 min-h-[120px]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] leading-snug">
          Deposits Held
        </span>
        <div className="my-1.5">
          {isLoading ? (
            <div className="h-8 w-24 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#1A2E20] font-sans tabular-nums whitespace-nowrap block">
              {formatINR(depositsHeld)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] block font-normal leading-tight">
          Refundable liability (period)
        </span>
      </div>

      {/* 3. Expenses Paid */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0 min-h-[120px]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] leading-snug">
          Expenses Paid
        </span>
        <div className="my-1.5">
          {isLoading ? (
            <div className="h-8 w-24 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#1A2E20] font-sans tabular-nums whitespace-nowrap block">
              {formatINR(expensesPaid)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] block font-normal leading-tight">
          Operational disbursements
        </span>
      </div>

      {/* 4. Net Cash Movement */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0 min-h-[120px]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] leading-snug">
          Net Cash Movement
        </span>
        <div className="my-1.5">
          {isLoading ? (
            <div className="h-8 w-28 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#1A2E20] font-sans tabular-nums whitespace-nowrap block">
              {isNetPositive ? "+" : "-"}{formatINR(Math.abs(netCashMovement))}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] block font-normal leading-tight">
          (Rent + Deposits) - Expenses
        </span>
      </div>

      {/* 5. Outstanding Rent */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0 min-h-[120px] col-span-1 sm:col-span-2 lg:col-span-1 xl:col-span-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] leading-snug">
          Outstanding Rent
        </span>
        <div className="my-1.5">
          {isLoading ? (
            <div className="h-8 w-24 bg-stone-100 rounded animate-pulse" />
          ) : (
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[#1A2E20] font-sans tabular-nums whitespace-nowrap block">
              {formatINR(outstandingRent)}
            </span>
          )}
        </div>
        <span className="text-xs text-[#5A6C5E] block font-normal leading-tight">
          All-time balance across residents
        </span>
      </div>
    </div>
  );
}
