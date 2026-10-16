"use client";

import React from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Shield,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
      {/* 1. Rent Collected */}
      <div className="bg-white rounded-2xl border border-emerald-200/80 bg-emerald-50/20 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            Rent Collected
          </span>
          <div className="w-7 h-7 rounded-lg bg-emerald-100/80 text-emerald-800 flex items-center justify-center border border-emerald-200">
            <ArrowDownLeft className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-emerald-950 font-serif tabular-nums">
            {isLoading ? (
              <div className="h-8 w-28 bg-emerald-100/60 rounded-md animate-pulse" />
            ) : (
              formatINR(rentCollected)
            )}
          </div>
          <span className="text-xs text-emerald-700/90 mt-1 block font-light">
            Period rent received
          </span>
        </div>
      </div>

      {/* 2. Deposits Held */}
      <div className="bg-white rounded-2xl border border-[#B58A57]/30 bg-[#FAF8F5]/80 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#654735]">
            Deposits Held
          </span>
          <div className="w-7 h-7 rounded-lg bg-[#FAF8F5] text-[#B58A57] flex items-center justify-center border border-[#B58A57]/40">
            <Shield className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums">
            {isLoading ? (
              <div className="h-8 w-24 bg-stone-200/60 rounded-md animate-pulse" />
            ) : (
              formatINR(depositsHeld)
            )}
          </div>
          <span className="text-xs text-[#654735]/80 mt-1 block font-light">
            Refundable liability (period)
          </span>
        </div>
      </div>

      {/* 3. Expenses Paid */}
      <div className="bg-white rounded-2xl border border-rose-200/80 bg-rose-50/20 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-800">
            Expenses Paid
          </span>
          <div className="w-7 h-7 rounded-lg bg-rose-100/80 text-rose-800 flex items-center justify-center border border-rose-200">
            <ArrowUpRight className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3">
          <div className="text-2xl sm:text-3xl font-bold tracking-tight text-rose-950 font-serif tabular-nums">
            {isLoading ? (
              <div className="h-8 w-24 bg-rose-100/60 rounded-md animate-pulse" />
            ) : (
              formatINR(expensesPaid)
            )}
          </div>
          <span className="text-xs text-rose-700/90 mt-1 block font-light">
            Period cash disbursements
          </span>
        </div>
      </div>

      {/* 4. Net Cash Movement */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5D7656]">
            Net Cash Movement
          </span>
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
              isNetPositive
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-rose-50 text-rose-800 border-rose-200"
            }`}
          >
            {isNetPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          </div>
        </div>
        <div className="mt-3">
          <div
            className={`text-2xl sm:text-3xl font-bold tracking-tight font-serif tabular-nums ${
              isNetPositive ? "text-[#1A2E20]" : "text-rose-800"
            }`}
          >
            {isLoading ? (
              <div className="h-8 w-28 bg-stone-200/60 rounded-md animate-pulse" />
            ) : (
              `${isNetPositive ? "+" : "-"}${formatINR(Math.abs(netCashMovement))}`
            )}
          </div>
          <span className="text-xs text-[#5E715C] mt-1 block font-light">
            (Rent + Deposits) - Expenses
          </span>
        </div>
      </div>

      {/* 5. Outstanding Rent (Current Lifetime Balance) */}
      <div className="bg-white rounded-2xl border border-amber-200/80 bg-amber-50/20 p-4 sm:p-5 shadow-2xs flex flex-col justify-between sm:col-span-2 lg:col-span-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
              Outstanding Rent
            </span>
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold border border-amber-300">
              Current
            </span>
          </div>
          <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center border border-amber-200">
            {outstandingRent > 0 ? (
              <AlertCircle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            )}
          </div>
        </div>
        <div className="mt-3">
          <div
            className={`text-2xl sm:text-3xl font-bold tracking-tight font-serif tabular-nums ${
              outstandingRent > 0 ? "text-amber-950" : "text-emerald-800"
            }`}
          >
            {isLoading ? (
              <div className="h-8 w-24 bg-amber-100/60 rounded-md animate-pulse" />
            ) : (
              formatINR(outstandingRent)
            )}
          </div>
          <span className="text-xs text-amber-800/80 mt-1 block font-light">
            All-time balance across residents
          </span>
        </div>
      </div>
    </div>
  );
}
