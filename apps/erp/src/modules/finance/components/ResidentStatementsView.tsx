"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  CreditCard,
  ArrowLeft,
  Download,
  Receipt,
  User,
  Phone,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Wallet,
  RotateCcw,
} from "lucide-react";
import { ResidentListItem, ResidentFinancialSummary } from "@/types";
import { formatINR, formatINRWithSign } from "../utils/formatUtils";
import { exportResidentStatementToCsv } from "../utils/exportCsv";

interface ResidentStatementsViewProps {
  residents: ResidentListItem[];
  isLoading: boolean;
  onOpenPaymentForResident: (residentId: string) => void;
  onLoadStatement: (residentId: string) => Promise<ResidentFinancialSummary | null>;
}

export function ResidentStatementsView({
  residents,
  isLoading,
  onOpenPaymentForResident,
  onLoadStatement,
}: ResidentStatementsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedStatement, setSelectedStatement] = useState<ResidentFinancialSummary | null>(null);
  const [loadingStatementId, setLoadingStatementId] = useState<string | null>(null);

  // Filter residents
  const filteredResidents = useMemo(() => {
    return residents.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const name = (r.fullName || "").toLowerCase();
        const phone = (r.phone || "").toLowerCase();
        const room = (r.currentRoomNumber || "").toLowerCase();
        const email = (r.email || "").toLowerCase();
        const id = r.id.toLowerCase();
        if (!name.includes(q) && !phone.includes(q) && !room.includes(q) && !email.includes(q) && !id.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [residents, statusFilter, searchQuery]);

  const handleOpenStatement = async (residentId: string) => {
    setLoadingStatementId(residentId);
    try {
      const summary = await onLoadStatement(residentId);
      if (summary) {
        setSelectedStatement(summary);
      }
    } finally {
      setLoadingStatementId(null);
    }
  };

  const handleBackToList = () => {
    setSelectedStatement(null);
  };

  // If a resident statement is selected, show the full statement detail dossier
  if (selectedStatement) {
    const hasOutstanding = selectedStatement.outstandingRentBalance > 0;

    return (
      <div className="space-y-6 sm:space-y-7 animate-fade-in">
        {/* Navigation & Actions Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#8E9F89]/20">
          <button
            type="button"
            onClick={handleBackToList}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-semibold transition-all shadow-2xs"
          >
            <ArrowLeft className="w-4 h-4 text-[#5D7656]" />
            <span>&larr; Back to Resident List</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => exportResidentStatementToCsv(selectedStatement)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-colors shadow-2xs"
            >
              <Download className="w-4 h-4 text-[#5D7656]" />
              <span>Export Statement CSV</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenPaymentForResident(selectedStatement.residentId)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-semibold transition-all shadow-md active:scale-95"
            >
              <CreditCard className="w-4 h-4 text-[#B58A57]" />
              <span>Collect Payment</span>
            </button>
          </div>
        </div>

        {/* Resident Identity Banner */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-5 sm:p-6 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-[#1A2E20] text-[#B58A57] flex items-center justify-center font-serif font-bold text-lg shrink-0 shadow-2xs">
                {selectedStatement.fullName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-serif text-[#1A2E20] font-bold">
                    {selectedStatement.fullName}
                  </h2>
                  {selectedStatement.currentRoomNumber ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#1A2E20] text-white">
                      Room {selectedStatement.currentRoomNumber}
                    </span>
                  ) : (
                    <span className="text-xs text-[#5A6C5E] italic">No room assigned</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-[#5A6C5E] mt-1 font-mono">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#5D7656]" />
                    {selectedStatement.phone}
                  </span>
                  <span>ID: {selectedStatement.residentId}</span>
                </div>
              </div>
            </div>

            {/* Current Balance Pill */}
            <div className="border border-[#8E9F89]/25 rounded-2xl px-5 py-3 bg-[#FAF8F5] text-right">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-[#6E7F70] block">
                Current Outstanding Rent
              </span>
              <span className="text-2xl font-serif font-bold tabular-nums text-[#1A2E20]">
                {formatINR(selectedStatement.outstandingRentBalance)}
              </span>
            </div>
          </div>
        </div>

        {/* 4 Standard Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {/* Outstanding Balance */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
              Outstanding Rent
            </span>
            <div className="mt-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
                {formatINR(selectedStatement.outstandingRentBalance)}
              </span>
            </div>
            <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
              {hasOutstanding ? "Dues pending collection" : "All rent accounts settled"}
            </span>
          </div>

          {/* Total Billed Rent */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
              Total Billed Rent
            </span>
            <div className="mt-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
                {formatINR(selectedStatement.totalRentCharges)}
              </span>
            </div>
            <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
              Cumulative posted charges
            </span>
          </div>

          {/* Total Rent Paid */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
              Total Rent Paid
            </span>
            <div className="mt-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
                {formatINR(selectedStatement.totalRentPaid)}
              </span>
            </div>
            <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
              Cumulative rent receipts
            </span>
          </div>

          {/* Security Deposit Held */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] truncate">
              Security Deposit Held
            </span>
            <div className="mt-2">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums truncate block">
                {formatINR(selectedStatement.totalSecurityDepositHeld)}
              </span>
            </div>
            <span className="text-xs text-[#5A6C5E] mt-2 block font-light truncate">
              Refundable liability (not rent)
            </span>
          </div>
        </div>

        {/* Chronological Account Ledger History */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#8E9F89]/20 flex items-center justify-between bg-[#FAF8F5]">
            <div>
              <h3 className="font-serif text-base text-[#1A2E20] font-bold">
                Account Ledger History
              </h3>
              <p className="text-xs text-[#5A6C5E] mt-0.5">
                Chronological statement of all rent charges, payment receipts, deposit collections, and adjustments.
              </p>
            </div>
            <span className="text-xs text-[#6E7F70] font-mono tabular-nums">
              {(selectedStatement.transactions || []).length} record{(selectedStatement.transactions || []).length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] uppercase font-semibold tracking-wider text-[#6E7F70]">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Billing Period</th>
                  <th className="py-3 px-4">Method &amp; Ref</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/15 text-xs text-[#1A2E20]">
                {(selectedStatement.transactions || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[#5A6C5E]">
                      No transaction records on file for this resident.
                    </td>
                  </tr>
                ) : (
                  (selectedStatement.transactions || []).map((t) => {
                    const isPayment = t.transactionType === "RENT_PAYMENT";
                    const isCharge = t.transactionType === "RENT_CHARGE";
                    const isDeposit = t.transactionType === "SECURITY_DEPOSIT";
                    const isReversal = t.transactionType === "REVERSAL";
                    const isReversed = t.status === "REVERSED";

                    const { formatted, isPositive, isNegative } = formatINRWithSign(
                      t.amount,
                      t.transactionType,
                      t.status
                    );

                    return (
                      <tr key={t.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium text-[#1A2E20] whitespace-nowrap">
                          {t.transactionDate}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isPayment && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <TrendingUp className="w-3 h-3" />
                              <span>Rent Payment</span>
                            </span>
                          )}
                          {isCharge && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FAF8F5] text-[#654735] border border-[#B58A57]/35">
                              <Receipt className="w-3 h-3 text-[#B58A57]" />
                              <span>Rent Charge</span>
                            </span>
                          )}
                          {isDeposit && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              <Wallet className="w-3 h-3 text-amber-800" />
                              <span>Deposit</span>
                            </span>
                          )}
                          {isReversal && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                              <RotateCcw className="w-3 h-3" />
                              <span>Reversal</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-[#1A2E20] whitespace-nowrap">
                          {t.billingPeriod || "—"}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {t.paymentMethod || "—"}
                          {t.referenceNumber && (
                            <span className="block text-[11px] text-[#6E7F70] font-mono">
                              Ref: {t.referenceNumber}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 max-w-[220px] truncate" title={t.description || ""}>
                          {t.description || "—"}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-bold tabular-nums">
                          <span
                            className={
                              isReversed
                                ? "line-through text-stone-400"
                                : isPositive
                                ? "text-emerald-700"
                                : isNegative
                                ? "text-rose-700"
                                : "text-[#1A2E20]"
                            }
                          >
                            {formatted}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Otherwise, render Searchable Resident Statements Directory
  return (
    <div className="space-y-4">
      {/* Search & Filter Bar (Matching Residents & Rooms pattern) */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-3.5 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#6E7F70] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search residents by name, phone, or assigned room number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs sm:text-sm text-[#1A2E20] placeholder:text-[#6E7F70] focus:outline-hidden focus:border-[#1A2E20] focus:ring-1 focus:ring-[#1A2E20]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E7F70] hover:text-[#1A2E20] text-sm font-bold"
            >
              &times;
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
          >
            <option value="ALL">All Residents</option>
            <option value="ACTIVE">Currently In-House (Active)</option>
            <option value="CHECKED_OUT">Checked Out</option>
          </select>

          <span className="text-xs text-[#6E7F70] pl-1 font-mono tabular-nums whitespace-nowrap">
            {filteredResidents.length} of {residents.length}
          </span>
        </div>
      </div>

      {/* Residents Table */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] uppercase font-semibold tracking-wider text-[#6E7F70]">
                <th className="py-3 px-4">Resident</th>
                <th className="py-3 px-4">Current Room</th>
                <th className="py-3 px-4">Contact Info</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/15 text-xs text-[#1A2E20]">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`res-skel-${idx}`} className="animate-pulse">
                    <td className="py-3 px-4">
                      <div className="h-4 w-32 bg-stone-200 rounded" />
                    </td>
                    <td className="py-3 px-4">
                      <div className="h-4 w-24 bg-stone-200 rounded" />
                    </td>
                    <td className="py-3 px-4">
                      <div className="h-4 w-28 bg-stone-200 rounded" />
                    </td>
                    <td className="py-3 px-4">
                      <div className="h-5 w-20 bg-stone-200 rounded-full" />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="h-7 w-28 bg-stone-200 rounded ml-auto" />
                    </td>
                  </tr>
                ))
              ) : filteredResidents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#5A6C5E]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center mx-auto text-[#1A2E20] mb-2">
                      <User className="w-6 h-6 text-[#B58A57]" />
                    </div>
                    <p className="font-serif text-base text-[#1A2E20] font-bold">No Residents Found</p>
                    <p className="text-xs text-[#5A6C5E] mt-1">No residents match your search or filter selection.</p>
                  </td>
                </tr>
              ) : (
                filteredResidents.map((r) => {
                  const isLoadingThis = loadingStatementId === r.id;

                  return (
                    <tr key={r.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                      {/* Resident Name & Avatar */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#1A2E20] text-[#B58A57] flex items-center justify-center font-serif font-bold text-xs shrink-0 shadow-2xs">
                            {r.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <button
                              onClick={() => handleOpenStatement(r.id)}
                              className="font-bold text-xs text-[#1A2E20] hover:text-[#B58A57] transition-colors text-left truncate block max-w-[200px]"
                              title="Click to view financial statement"
                            >
                              {r.fullName}
                            </button>
                            <span className="text-[10px] text-[#6E7F70] font-mono">{r.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Current Room */}
                      <td className="py-3 px-4">
                        {r.currentRoomNumber ? (
                          <div className="font-medium text-[#1A2E20]">
                            Room {r.currentRoomNumber}
                            <span className="text-[10px] text-[#5A6C5E] block font-light">
                              {r.currentFloor === 0 ? "Ground Floor" : `Floor ${r.currentFloor}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-[#5A6C5E] italic">Not assigned</span>
                        )}
                      </td>

                      {/* Contact Info */}
                      <td className="py-3 px-4 font-mono text-[#1A2E20]">
                        <div>{r.phone}</div>
                        {r.email && <div className="text-[10px] text-[#5A6C5E] font-sans">{r.email}</div>}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                            r.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-stone-100 text-stone-700 border-stone-200"
                          }`}
                        >
                          {r.status === "ACTIVE" ? "In-House" : "Checked Out"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenStatement(r.id)}
                          disabled={isLoadingThis}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs font-semibold transition-all shadow-2xs"
                        >
                          <span>{isLoadingThis ? "Loading..." : "View Statement"}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-[#B58A57]" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
