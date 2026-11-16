"use client";

import React, { useMemo } from "react";
import { RotateCcw, AlertTriangle } from "lucide-react";
import { Segmented } from "@/components/ui/kit";
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
    <div className="flex flex-wrap items-center gap-3 min-w-0">
      <Segmented
        label="Period"
        size="sm"
        value={activePreset}
        onChange={(p) => handleSelectPreset(p as PeriodPreset)}
        options={[
          { value: "THIS_MONTH", label: "This month" },
          { value: "LAST_30_DAYS", label: "Last 30 days" },
          { value: "ALL_TIME", label: "All time" },
        ]}
      />
      <div className="flex items-center gap-2">
        <input type="date" value={startDate} onChange={(e) => onDateRangeChange(e.target.value, endDate)} max={endDate} aria-label="From" className="rn-input !w-[150px]" />
        <span className="text-[13px] text-[var(--rn-ink-3)]">to</span>
        <input type="date" value={endDate} onChange={(e) => onDateRangeChange(startDate, e.target.value)} min={startDate} aria-label="To" className="rn-input !w-[150px]" />
      </div>
      {hasActiveFilters && activePreset === "CUSTOM" && (
        <button type="button" onClick={onResetFilters} className="rn-btn rn-btn-sm">
          <RotateCcw /> This month
        </button>
      )}
      {!validation.isValid && (
        <p role="alert" className="flex items-center gap-1.5 text-[13px] text-[#9A3423]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {validation.error}
        </p>
      )}
    </div>
  );
}
