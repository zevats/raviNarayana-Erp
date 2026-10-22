import React from "react";

export default function ManagementLoading() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-pulse select-none">
      {/* Top Banner / Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-[#8E9F89]/20">
        <div className="space-y-2">
          <div className="h-7 w-48 bg-[#1A2E20]/10 rounded-lg" />
          <div className="h-4 w-72 bg-[#1A2E20]/5 rounded-md" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-9 w-28 bg-[#C89F6B]/20 rounded-xl" />
          <div className="h-9 w-9 bg-[#1A2E20]/10 rounded-xl" />
        </div>
      </div>

      {/* KPI Stat Cards Skeleton (4 Columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white rounded-2xl p-5 border border-[#8E9F89]/20 shadow-2xs space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 bg-[#1A2E20]/10 rounded" />
              <div className="h-8 w-8 bg-[#C89F6B]/15 rounded-xl" />
            </div>
            <div className="h-8 w-32 bg-[#1A2E20]/15 rounded-lg" />
            <div className="h-3 w-20 bg-[#1A2E20]/5 rounded" />
          </div>
        ))}
      </div>

      {/* Main Content Area Skeleton */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/20 shadow-2xs overflow-hidden">
        {/* Table/List Filter Bar */}
        <div className="p-5 border-b border-[#8E9F89]/15 flex flex-wrap items-center justify-between gap-4 bg-[#FAF8F5]/50">
          <div className="h-10 w-64 bg-white border border-[#8E9F89]/20 rounded-xl" />
          <div className="flex gap-2">
            <div className="h-10 w-24 bg-white border border-[#8E9F89]/20 rounded-xl" />
            <div className="h-10 w-32 bg-[#1A2E20]/10 rounded-xl" />
          </div>
        </div>

        {/* Placeholder Rows */}
        <div className="divide-y divide-[#8E9F89]/10">
          {[1, 2, 3, 4, 5, 6].map((row) => (
            <div key={row} className="p-4 sm:p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-[#1A2E20]/5 shrink-0" />
                <div className="space-y-1.5">
                  <div className="h-4 w-40 bg-[#1A2E20]/10 rounded" />
                  <div className="h-3 w-28 bg-[#1A2E20]/5 rounded" />
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-6">
                <div className="h-4 w-20 bg-[#1A2E20]/10 rounded" />
                <div className="h-6 w-24 bg-[#C89F6B]/15 rounded-full" />
              </div>
              <div className="h-8 w-20 bg-[#1A2E20]/5 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
