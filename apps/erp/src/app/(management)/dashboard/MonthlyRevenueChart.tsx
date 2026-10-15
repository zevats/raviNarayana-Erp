"use client";

import React, { useState } from "react";
import { ChevronDown, TrendingUp } from "lucide-react";

interface MonthlyDataPoint {
  month: string;
  label: string;
  collected: number;
  expenses: number;
}

interface MonthlyRevenueChartProps {
  data: MonthlyDataPoint[];
}

export function MonthlyRevenueChart({ data }: MonthlyRevenueChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Compute maximum for bar scaling
  const maxVal = Math.max(...data.map((d) => Math.max(d.collected, d.expenses)), 100000);

  // Identify peak month
  const peakCollected = Math.max(...data.map((d) => d.collected));

  return (
    <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs flex flex-col justify-between">
      {/* Chart Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-[#1A2E20] tracking-tight">
            Monthly Revenue
          </h3>
          <p className="text-xs text-[#5A6C5E] mt-0.5">
            Collections across the last 6 months
          </p>
        </div>

        {/* Year Dropdown Indicator */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/30 text-xs font-medium text-[#1A2E20]">
          <span>Year 2026</span>
          <ChevronDown className="w-3.5 h-3.5 text-[#5A6C5E]" />
        </div>
      </div>

      {/* Chart Area */}
      <div className="relative pt-6 pb-2">
        {/* Subtle Horizontal Reference Grid Lines */}
        <div className="absolute inset-x-0 top-6 bottom-8 flex flex-col justify-between pointer-events-none">
          <div className="border-b border-stone-200/50 w-full" />
          <div className="border-b border-stone-200/50 w-full" />
          <div className="border-b border-stone-200/50 w-full" />
          <div className="border-b border-stone-200/50 w-full" />
        </div>

        {/* Hover Tooltip display */}
        <div className="h-7 mb-2 flex items-center justify-center">
          {hoveredIdx !== null && data[hoveredIdx] ? (
            <div className="inline-flex items-center gap-3 px-3 py-1 rounded-full bg-[#1A2E20] text-white text-[11px] shadow-sm animate-in fade-in duration-100">
              <span className="font-semibold text-[#C89F6B]">{data[hoveredIdx].label} 2026</span>
              <span>Collected: <strong className="font-semibold text-emerald-400">₹{data[hoveredIdx].collected.toLocaleString("en-IN")}</strong></span>
              <span>Expenses: <strong className="font-semibold text-rose-300">₹{data[hoveredIdx].expenses.toLocaleString("en-IN")}</strong></span>
            </div>
          ) : (
            <div className="text-[11px] text-[#8E9F89]">
              Hover over pillars to view verified collections & expenses
            </div>
          )}
        </div>

        {/* 6 Vertical Pillars */}
        <div className="grid grid-cols-6 gap-2 sm:gap-4 items-end h-44 relative z-10 px-2 sm:px-6">
          {data.map((item, idx) => {
            const isPeak = item.collected === peakCollected && item.collected > 0;
            const isHovered = hoveredIdx === idx;
            // Height ratio (minimum 6% for zero values so base dot is visible)
            const heightPercent = item.collected > 0 
              ? Math.max(12, Math.round((item.collected / maxVal) * 90))
              : 8;

            return (
              <div
                key={item.month}
                className="flex flex-col items-center h-full justify-end cursor-pointer group"
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                {/* Bar Pillar */}
                <div className="w-full flex justify-center items-end h-full">
                  <div
                    style={{ height: `${heightPercent}%` }}
                    className={`w-3 sm:w-3.5 rounded-t-full transition-all duration-300 relative flex flex-col justify-end items-center ${
                      isPeak
                        ? "bg-[#6E5A2A] group-hover:bg-[#B58A57] shadow-xs"
                        : item.collected > 0
                        ? "bg-[#D6CEBE] group-hover:bg-[#5D7656]"
                        : "bg-stone-200/70"
                    }`}
                  >
                    {/* Base anchor cap */}
                    <div
                      className={`w-4 sm:w-4.5 h-1.5 rounded-full -mb-0.5 shrink-0 transition-colors ${
                        isPeak
                          ? "bg-[#4E3628]"
                          : item.collected > 0
                          ? "bg-[#654735]"
                          : "bg-stone-300"
                      }`}
                    />
                  </div>
                </div>

                {/* Month Label */}
                <span
                  className={`mt-3 text-[11px] uppercase tracking-wider font-semibold transition-colors ${
                    isHovered
                      ? "text-[#1A2E20]"
                      : isPeak
                      ? "text-[#B58A57]"
                      : "text-[#8E9F89]"
                  }`}
                >
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Metrics */}
      <div className="pt-4 border-t border-[#8E9F89]/20 flex items-center justify-between text-xs text-[#5A6C5E]">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
          <span>Peak Collection: <strong className="text-[#1A2E20] font-semibold">₹{peakCollected.toLocaleString("en-IN")}</strong></span>
        </div>
        <div className="text-[11px] text-[#8E9F89]">
          Database-backed posted transactions
        </div>
      </div>
    </div>
  );
}
