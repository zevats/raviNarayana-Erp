"use client";

import React, { useMemo } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";
import {
  toLocalDateString,
  getLocalFirstDayOfMonth,
  getLocalDaysAgo,
  validateDateRange,
} from "../utils/dateUtils";

export type PeriodPreset = "THIS_MONTH" | "LAST_30_DAYS" | "ALL_TIME" | "CUSTOM";

interface AccountingPeriodSelectorProps {
  startDate: string;
  endDate: string;
  onDateRangeChange: (start: string, end: string) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}

export function AccountingPeriodSelector({
  startDate,
  endDate,
  onDateRangeChange,
  onResetFilters,
  hasActiveFilters,
}: AccountingPeriodSelectorProps) {
  const today = toLocalDateString();
  const firstOfMonth = getLocalFirstDayOfMonth();
  const thirtyDaysAgo = getLocalDaysAgo(30);

  // Determine active preset based on current start and end dates
  const activePreset: PeriodPreset = useMemo(() => {
    if (startDate === firstOfMonth && endDate === today) {
      return "THIS_MONTH";
    }
    if (startDate === thirtyDaysAgo && endDate === today) {
      return "LAST_30_DAYS";
    }
    if (startDate === "2026-01-01" && endDate === today) {
      return "ALL_TIME";
    }
    return "CUSTOM";
  }, [startDate, endDate, firstOfMonth, thirtyDaysAgo, today]);

  const validation = validateDateRange(startDate, endDate);

  const handleSelectPreset = (preset: PeriodPreset) => {
    if (preset === "THIS_MONTH") {
      onDateRangeChange(firstOfMonth, today);
    } else if (preset === "LAST_30_DAYS") {
      onDateRangeChange(thirtyDaysAgo, today);
    } else if (preset === "ALL_TIME") {
      onDateRangeChange("2026-01-01", today);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
      {/* Period Presets Segmented Bar */}
      <div className="inline-flex p-1 bg-[#FAF8F5] border border-[#8E9F89]/25 rounded-xl gap-1">
        <button
          type="button"
          onClick={() => handleSelectPreset("THIS_MONTH")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activePreset === "THIS_MONTH"
              ? "bg-[#1A2E20] text-white shadow-xs"
              : "text-[#5A6C5E] hover:text-[#1A2E20]"
          }`}
        >
          This Month
        </button>

        <button
          type="button"
          onClick={() => handleSelectPreset("LAST_30_DAYS")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activePreset === "LAST_30_DAYS"
              ? "bg-[#1A2E20] text-white shadow-xs"
              : "text-[#5A6C5E] hover:text-[#1A2E20]"
          }`}
        >
          Last 30 Days
        </button>

        <button
          type="button"
          onClick={() => handleSelectPreset("ALL_TIME")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activePreset === "ALL_TIME"
              ? "bg-[#1A2E20] text-white shadow-xs"
              : "text-[#5A6C5E] hover:text-[#1A2E20]"
          }`}
        >
          All Time
        </button>
      </div>

      {/* Date Range Inputs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[#FAF8F5] px-2.5 py-1.5 rounded-xl border border-[#8E9F89]/25 text-xs min-w-0">
        <span className="text-[11px] text-[#5A6C5E] font-medium">From:</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onDateRangeChange(e.target.value, endDate)}
          max={endDate}
          className="bg-transparent text-[#1A2E20] font-sans font-medium text-xs focus:outline-hidden cursor-pointer"
        />
        <span className="text-[11px] text-[#5A6C5E] font-medium">To:</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onDateRangeChange(startDate, e.target.value)}
          min={startDate}
          className="bg-transparent text-[#1A2E20] font-sans font-medium text-xs focus:outline-hidden cursor-pointer"
        />
      </div>

      {/* Reset Button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[11px] text-[#654735] hover:text-[#1A2E20] transition-colors shadow-2xs"
          title="Reset to current month"
        >
          <RotateCcw className="w-3 h-3 text-[#B58A57]" />
          <span>Reset</span>
        </button>
      )}

      {!validation.isValid && (
        <div className="flex items-center gap-1 text-rose-700 text-xs pl-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{validation.error}</span>
        </div>
      )}
    </div>
  );
}
