"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  FileText,
  CreditCard,
  ArrowLeft,
  Download,
  AlertCircle,
  CheckCircle2,
  Shield,
  Receipt,
  User,
  Phone,
  Mail,
  Home,
  TrendingUp,
} from "lucide-react";
import { ResidentListItem, ResidentFinancialSummary } from "@/types";
import { formatINR } from "../utils/formatUtils";
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

  // If a resident statement is selected, show the full statement detail dossier!
  if (selectedStatement) {
    const hasOutstanding = selectedStatement.outstandingRentBalance > 0;

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Navigation & Actions Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#8E9F89]/20">
          <button
            type="button"
            onClick={handleBackToList}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-colors shadow-2xs"
          >
            <ArrowLeft className="w-4 h-4 text-[#5D7656]" />
            <span>Back to Resident List</span>
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
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-medium transition-all shadow-md active:scale-95"
            >
              <CreditCard className="w-4 h-4 text-[#B58A57]" />
              <span>Collect Payment</span>
            </button>
          </div>
        </div>

        {/* Resident Identity Banner */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-5 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center text-[#1A2E20] font-serif font-bold text-lg shrink-0">
                {selectedStatement.fullName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-serif text-[#1A2E20] font-normal">
                    {selectedStatement.fullName}
                  </h2>
                  {selectedStatement.currentRoomNumber ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#1A2E20] text-white">
                      Room {selectedStatement.currentRoomNumber}
                    </span>
                  ) : (
                    <span className="text-xs text-[#5E715C] italic">No room assigned</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-[#5E715C] mt-1 font-mono">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#5D7656]" />
                    {selectedStatement.phone}
                  </span>
                  <span>ID: {selectedStatement.residentId}</span>
                </div>
              </div>
            </div>

            {/* Current Balance Tag */}
            <div
              className={`px-4 py-3 rounded-xl border flex flex-col items-end justify-center ${
                hasOutstanding
                  ? "bg-amber-50/60 border-amber-200 text-amber-900"
                  : "bg-emerald-50/60 border-emerald-200 text-emerald-900"
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider font-semibold">
                Current Outstanding Rent
              </span>
              <span className="text-2xl font-serif font-bold tabular-nums">
                {formatINR(selectedStatement.outstandingRentBalance)}
              </span>
            </div>
          </div>
        </div>

        {/* 4 Financial Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Outstanding Balance */}
          <div className="bg-white rounded-2xl border border-amber-200/80 bg-amber-50/20 p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-900 block">
              Outstanding Rent
            </span>
            <div className="text-2xl font-bold tracking-tight text-amber-950 font-serif tabular-nums mt-2">
              {formatINR(selectedStatement.outstandingRentBalance)}
            </div>
            <span className="text-xs text-amber-800/80 mt-1 block font-light">
              {hasOutstanding ? "Dues pending collection" : "All rent accounts settled"}
            </span>
          </div>

          {/* Total Billed Rent */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5D7656] block">
              Total Billed Rent
            </span>
            <div className="text-2xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums mt-2">
              {formatINR(selectedStatement.totalRentCharges)}
            </div>
            <span className="text-xs text-[#5E715C] mt-1 block font-light">
              Cumulative posted rent charges
            </span>
          </div>

          {/* Total Rent Paid */}
          <div className="bg-white rounded-2xl border border-emerald-200/80 bg-emerald-50/20 p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 block">
              Total Rent Paid
            </span>
            <div className="text-2xl font-bold tracking-tight text-emerald-950 font-serif tabular-nums mt-2">
              {formatINR(selectedStatement.totalRentPaid)}
            </div>
            <span className="text-xs text-emerald-700/90 mt-1 block font-light">
              Cumulative rent receipts
            </span>
          </div>

          {/* Security Deposit Held */}
          <div className="bg-white rounded-2xl border border-[#B58A57]/30 bg-[#FAF8F5]/80 p-4 shadow-2xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#654735] block">
              Security Deposit Held
            </span>
            <div className="text-2xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums mt-2">
              {formatINR(selectedStatement.totalSecurityDepositHeld)}
            </div>
            <span className="text-xs text-[#654735]/80 mt-1 block font-light">
              Refundable liability (not rent)
            </span>
          </div>
        </div>

        {/* Chronological Account Ledger History */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/20 shadow-2xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#8E9F89]/15 flex items-center justify-between bg-[#FAF8F5]/80">
            <div>
              <h3 className="font-serif text-base text-[#1A2E20] font-medium">
                Account Ledger History
              </h3>
              <p className="text-xs text-[#5E715C] mt-0.5 font-light">
                Chronological statement of all rent charges, payment receipts, deposit collections, and adjustments.
              </p>
            </div>
            <span className="text-xs text-[#5E715C] font-mono">
              {(selectedStatement.transactions || []).length} records
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#8E9F89]/15 bg-[#FAF8F5]/50 text-[#5D7656] font-serif uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Type</th>
                  <th className="py-3 px-4 font-semibold">Method &amp; Ref</th>
                  <th className="py-3 px-4 font-semibold">Billing Period / Notes</th>
                  <th className="py-3 px-4 font-semibold text-right">Amount (₹)</th>
                  <th className="py-3 px-4 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/10">
                {(selectedStatement.transactions || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[#5E715C]">
                      No financial records found for this resident.
                    </td>
                  </tr>
                ) : (
                  selectedStatement.transactions.map((t) => {
                    const isPayment = t.transactionType === "RENT_PAYMENT";
                    const isCharge = t.transactionType === "RENT_CHARGE";
                    const isDeposit = t.transactionType === "SECURITY_DEPOSIT";
                    const isReversed = t.status === "REVERSED";

                    return (
                      <tr
                        key={t.id}
                        className={`hover:bg-[#FAF8F5]/60 transition-colors ${
                          isReversed ? "bg-stone-50/70 opacity-60" : ""
                        }`}
                      >
                        <td className="py-3 px-4 font-mono whitespace-nowrap text-[#1A2E20]">
                          {t.transactionDate}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {isPayment && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Rent Payment
                            </span>
                          )}
                          {isCharge && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF8F5] text-[#654735] border border-[#B58A57]/35">
                              Rent Charge
                            </span>
                          )}
                          {isDeposit && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
                              Security Deposit
                            </span>
                          )}
                          {t.transactionType === "REVERSAL" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-100 text-stone-700 border border-stone-300">
                              Reversal
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          {t.paymentMethod ? (
                            <div>
                              <span className="text-[#1A2E20] font-medium block">
                                {t.paymentMethod}
                              </span>
                              {t.referenceNumber && (
                                <span className="text-[10px] font-mono text-[#5E715C]">
                                  Ref: {t.referenceNumber}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[#5E715C]">—</span>
                          )}
                        </td>

                        <td className="py-3 px-4 max-w-xs truncate">
                          {t.billingPeriod && (
                            <span className="font-medium text-[#1A2E20] block">
                              Period: {t.billingPeriod}
                            </span>
                          )}
                          <span className="text-[#5E715C] text-[11px] block truncate">
                            {t.description || "—"}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap font-mono font-semibold">
                          <span
                            className={
                              isReversed
                                ? "line-through text-stone-400"
                                : isPayment || isDeposit
                                ? "text-emerald-700"
                                : "text-[#1A2E20]"
                            }
                          >
                            {isPayment || isDeposit ? `+${formatINR(t.amount)}` : formatINR(t.amount)}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {isReversed ? (
                            <span className="px-2 py-0.5 rounded text-[9px] uppercase font-bold bg-red-100 text-red-800 border border-red-300">
                              Reversed
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[9px] uppercase font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                              Posted
                            </span>
                          )}
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

  // Otherwise, render the Searchable Resident Statements Directory
  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[260px] bg-[#FAF8F5] px-3.5 py-2 rounded-xl border border-[#8E9F89]/25">
          <Search className="w-4 h-4 text-[#5D7656] shrink-0" />
          <input
            type="text"
            placeholder="Search residents by name, phone, room, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-[#1A2E20] placeholder-[#5E715C]/60 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-[#5E715C] hover:text-[#1A2E20] text-xs font-bold px-1"
            >
              &times;
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#5E715C] font-semibold uppercase tracking-wider font-serif">
            Status:
          </span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-none font-medium"
          >
            <option value="ALL">All Residents</option>
            <option value="ACTIVE">In-House (Active)</option>
            <option value="CHECKED_OUT">Checked Out</option>
          </select>
        </div>
      </div>

      {/* Residents Table */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/20 shadow-2xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#8E9F89]/15 flex items-center justify-between bg-[#FAF8F5]/80">
          <div>
            <h3 className="font-serif text-base text-[#1A2E20] font-medium">
              Resident Rent Accounts &amp; Statements Directory
            </h3>
            <p className="text-xs text-[#5E715C] mt-0.5 font-light">
              Select any resident to view their full account statement, outstanding balances, and historical ledger.
            </p>
          </div>
          <span className="text-xs text-[#5E715C] font-mono">
            {filteredResidents.length} residents
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#8E9F89]/15 bg-[#FAF8F5]/50 text-[#5D7656] font-serif uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4 font-semibold">Resident</th>
                <th className="py-3.5 px-4 font-semibold">Room &amp; Floor</th>
                <th className="py-3.5 px-4 font-semibold">Contact Info</th>
                <th className="py-3.5 px-4 font-semibold">Status</th>
                <th className="py-3.5 px-4 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/10">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`res-skel-${idx}`} className="animate-pulse">
                    <td className="py-4 px-4">
                      <div className="h-4 w-32 bg-stone-200 rounded mb-1" />
                      <div className="h-3 w-20 bg-stone-100 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 w-24 bg-stone-200 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 w-28 bg-stone-200 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-5 w-20 bg-stone-200 rounded-full" />
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="h-7 w-32 bg-stone-200 rounded mx-auto" />
                    </td>
                  </tr>
                ))
              ) : filteredResidents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#5E715C]">
                    <User className="w-8 h-8 mx-auto text-[#8E9F89]/50 mb-2" />
                    <p className="font-serif text-sm text-[#1A2E20]">No residents match your search</p>
                  </td>
                </tr>
              ) : (
                filteredResidents.map((r) => {
                  const isLoadingThis = loadingStatementId === r.id;

                  return (
                    <tr key={r.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                      {/* Resident Name & ID */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/25 flex items-center justify-center text-[#1A2E20] font-serif font-bold text-xs shrink-0">
                            {r.fullName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-medium text-[#1A2E20] block">{r.fullName}</span>
                            <span className="text-[10px] text-[#5E715C] font-mono">{r.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Room & Floor */}
                      <td className="py-3.5 px-4">
                        {r.currentRoomNumber ? (
                          <div className="flex flex-col">
                            <span className="inline-flex items-center gap-1 font-medium text-[#1A2E20]">
                              <Home className="w-3 h-3 text-[#5D7656]" />
                              Room {r.currentRoomNumber}
                            </span>
                            <span className="text-[10px] text-[#5E715C]">
                              {r.currentFloor === 0 ? "Ground Floor" : `Floor ${r.currentFloor}`}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#5E715C] italic">No room assigned</span>
                        )}
                      </td>

                      {/* Contact */}
                      <td className="py-3.5 px-4 font-mono text-[#1A2E20]">
                        <div className="flex flex-col">
                          <span>{r.phone}</span>
                          {r.email && <span className="text-[10px] text-[#5E715C]">{r.email}</span>}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            r.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-stone-100 text-stone-700 border-stone-200"
                          }`}
                        >
                          {r.status === "ACTIVE" ? "In-House" : r.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenStatement(r.id)}
                            disabled={isLoadingThis}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] font-medium text-xs transition-colors shadow-2xs disabled:opacity-50"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#5D7656]" />
                            <span>{isLoadingThis ? "Loading..." : "Statement"}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenPaymentForResident(r.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white font-medium text-xs transition-colors shadow-2xs active:scale-95"
                          >
                            <CreditCard className="w-3.5 h-3.5 text-[#B58A57]" />
                            <span>Collect</span>
                          </button>
                        </div>
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
