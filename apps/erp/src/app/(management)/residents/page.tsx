"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  Plus,
  Search,
  Filter,
  BedDouble,
  LogOut,
  Calendar,
  History,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  RefreshCw,
  Phone,
  Mail,
  ArrowRight,
  Wallet,
  CreditCard,
  UserCog,
  Edit3,
  UserCheck,
  Building2,
  Clock,
  ShieldCheck,
  FileText,
  User,
} from "lucide-react";
import {
  ResidentListItem,
  ResidentDetail,
  RoomWithOccupancy,
  ResidentFinancialSummary,
  ResidentStayRecord,
} from "@/types";

/**
 * Maps database floor integer to human-readable full label.
 */
function formatFloorLabel(floor: number | null | undefined): string {
  if (floor === null || floor === undefined) return "";
  if (floor === 0) return "Ground Floor";
  return `Floor ${floor}`;
}

export default function ResidentsPage() {
  const [residents, setResidents] = useState<ResidentListItem[]>([]);
  const [rooms, setRooms] = useState<RoomWithOccupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<
    "ALL" | "ACTIVE" | "CHECKED_OUT" | "UNASSIGNED"
  >("ALL");

  // Notifications
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Modal States
  // ---------------------------------------------------------------------------
  // 1. Register Resident Modal
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    emergencyContact: "",
    notes: "",
  });

  // 2. Assign Room / Check-In Modal
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [checkInForm, setCheckInForm] = useState({
    residentId: "",
    roomId: "",
    checkInDate: new Date().toISOString().slice(0, 10),
    monthlyRent: 8500,
    securityDeposit: 5000,
  });
  const [showCheckInConfirm, setShowCheckInConfirm] = useState(false);

  // 3. Check-Out Modal
  const [checkOutResidentTarget, setCheckOutResidentTarget] = useState<ResidentListItem | null>(null);
  const [checkOutDate, setCheckOutDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [targetOutstandingBalance, setTargetOutstandingBalance] = useState<number | null>(null);

  // 4. Resident Detail View & Stay History Modal
  const [viewHistoryResident, setViewHistoryResident] = useState<ResidentDetail | null>(null);
  const [residentFinanceSummary, setResidentFinanceSummary] = useState<ResidentFinancialSummary | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // 5. Edit Resident Profile Modal
  const [editingResident, setEditingResident] = useState<ResidentDetail | null>(null);
  const [editProfileForm, setEditProfileForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    emergencyContact: "",
    notes: "",
  });
  const [showEditConfirm, setShowEditConfirm] = useState(false);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------
  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [resResidents, resRooms] = await Promise.all([
        fetch("/api/residents", { cache: "no-store" }),
        fetch("/api/rooms", { cache: "no-store" }),
      ]);

      const dataResidents = await resResidents.json();
      const dataRooms = await resRooms.json();

      if (!resResidents.ok) throw new Error(dataResidents.error || "Failed to load residents");
      if (!resRooms.ok) throw new Error(dataRooms.error || "Failed to load rooms");

      setResidents(dataResidents.residents || []);
      setRooms(dataRooms.rooms || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ---------------------------------------------------------------------------
  // Computed KPI Metrics (Accurate, Distinct Database Definitions)
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const total = residents.length;
    // In-house: distinct residents with active room assignment
    const active = residents.filter(
      (r) => r.status === "ACTIVE" && Boolean(r.currentRoomNumber)
    ).length;
    // Checked out: unassigned residents with at least 1 completed stay
    const checkedOutCount = residents.filter(
      (r) =>
        (!r.currentRoomNumber || r.status === "CHECKED_OUT") &&
        (r.totalStayCount ?? 0) > 0
    ).length;
    // Never assigned / pending: unassigned residents with 0 stays
    const unassignedCount = residents.filter(
      (r) =>
        !r.currentRoomNumber &&
        (r.totalStayCount ?? 0) === 0
    ).length;

    const checkedOutTotal = total - active;
    return { total, active, checkedOutTotal, checkedOutCount, unassignedCount };
  }, [residents]);

  // ---------------------------------------------------------------------------
  // Filtered Residents List
  // ---------------------------------------------------------------------------
  const filteredResidents = useMemo(() => {
    return residents.filter((r) => {
      const term = search.trim().toLowerCase();
      const matchesSearch =
        term === "" ||
        r.fullName.toLowerCase().includes(term) ||
        r.phone.includes(term) ||
        (r.currentRoomNumber && r.currentRoomNumber.toLowerCase().includes(term));

      const isInHouse = r.status === "ACTIVE" && Boolean(r.currentRoomNumber);
      const isCheckedOut = !isInHouse && (r.totalStayCount ?? 0) > 0;
      const isUnassigned = !isInHouse && (r.totalStayCount ?? 0) === 0;

      const matchesStatus =
        selectedStatus === "ALL" ||
        (selectedStatus === "ACTIVE" && isInHouse) ||
        (selectedStatus === "CHECKED_OUT" && isCheckedOut) ||
        (selectedStatus === "UNASSIGNED" && isUnassigned);

      return matchesSearch && matchesStatus;
    });
  }, [residents, search, selectedStatus]);

  // Available rooms with vacant capacity
  const availableRooms = useMemo(() => {
    return rooms.filter((r) => r.isActive && r.availableBeds > 0);
  }, [rooms]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  // Open Detailed Resident View & Stay History
  const handleViewDetails = async (residentId: string) => {
    setLoadingHistory(true);
    setViewHistoryResident(null);
    setResidentFinanceSummary(null);

    try {
      const [res, finRes] = await Promise.all([
        fetch(`/api/residents/${residentId}`, { cache: "no-store" }),
        fetch(`/api/finance/residents/${residentId}`, { cache: "no-store" }),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load stay history");
      setViewHistoryResident(data.resident);

      if (finRes.ok) {
        const finData = await finRes.json();
        setResidentFinanceSummary(finData.summary || null);
      }
    } catch (err: any) {
      alert(err.message || "Failed to load stay history");
    } finally {
      setLoadingHistory(false);
    }
  };

  // Open Edit Resident Modal (from table row or from details view)
  const handleOpenEdit = async (residentId: string) => {
    setActionError(null);
    setShowEditConfirm(false);

    try {
      const res = await fetch(`/api/residents/${residentId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load resident profile");

      setEditingResident(data.resident);
      setEditProfileForm({
        fullName: data.resident.fullName || "",
        phone: data.resident.phone || "",
        email: data.resident.email || "",
        emergencyContact: data.resident.emergencyContact || "",
        notes: data.resident.notes || "",
      });
    } catch (err: any) {
      setActionError(err.message || "Failed to fetch resident details");
    }
  };

  // Submit Profile Edits
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResident) return;

    // Review step before final commit
    if (!showEditConfirm) {
      if (!editProfileForm.fullName.trim() || editProfileForm.fullName.trim().length < 2) {
        setActionError("Full legal name must be at least 2 characters.");
        return;
      }
      if (!editProfileForm.phone.trim() || editProfileForm.phone.trim().length < 10) {
        setActionError("Valid phone number with at least 10 digits is required.");
        return;
      }
      setActionError(null);
      setShowEditConfirm(true);
      return;
    }

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/residents/${editingResident.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: editProfileForm.fullName.trim(),
          phone: editProfileForm.phone.trim(),
          email: editProfileForm.email.trim() || null,
          emergencyContact: editProfileForm.emergencyContact.trim() || null,
          notes: editProfileForm.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update profile");

      setActionSuccess(`Profile for ${data.resident.fullName} updated successfully.`);
      setEditingResident(null);
      setShowEditConfirm(false);

      // If view history modal was also open, update its resident data
      if (viewHistoryResident && viewHistoryResident.id === editingResident.id) {
        handleViewDetails(editingResident.id);
      }

      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to update profile");
      setShowEditConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Register New Resident
  const handleRegisterResident = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/residents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: registerForm.fullName.trim(),
          phone: registerForm.phone.trim(),
          email: registerForm.email.trim() || null,
          emergencyContact: registerForm.emergencyContact.trim() || null,
          notes: registerForm.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to register resident");

      setActionSuccess(`Resident ${data.resident.fullName} registered successfully.`);
      setIsRegisterModalOpen(false);
      setRegisterForm({
        fullName: "",
        phone: "",
        email: "",
        emergencyContact: "",
        notes: "",
      });

      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to register resident");
    } finally {
      setSubmitting(false);
    }
  };

  // Open Assign Room Modal (from row or header)
  const handleOpenCheckInModal = (residentId?: string) => {
    setActionError(null);
    setShowCheckInConfirm(false);
    setCheckInForm({
      residentId: residentId || "",
      roomId: "",
      checkInDate: new Date().toISOString().slice(0, 10),
      monthlyRent: 8500,
      securityDeposit: 5000,
    });
    setIsCheckInModalOpen(true);
  };

  // Submit Check-In / Room Assignment
  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkInForm.residentId || !checkInForm.roomId) return;

    if (!showCheckInConfirm) {
      setActionError(null);
      setShowCheckInConfirm(true);
      return;
    }

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/residents/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: checkInForm.residentId,
          roomId: checkInForm.roomId,
          checkInDate: checkInForm.checkInDate,
          monthlyRent: Number(checkInForm.monthlyRent),
          securityDeposit: Number(checkInForm.securityDeposit || 0),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check in resident");

      const assignedResident = residents.find((r) => r.id === checkInForm.residentId);
      const assignedRoom = rooms.find((r) => r.id === checkInForm.roomId);

      setActionSuccess(
        `Resident ${assignedResident?.fullName || "Resident"} successfully checked in to Room ${assignedRoom?.roomNumber || ""}.`
      );
      setIsCheckInModalOpen(false);
      setShowCheckInConfirm(false);

      if (viewHistoryResident && viewHistoryResident.id === checkInForm.residentId) {
        handleViewDetails(checkInForm.residentId);
      }

      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to check in resident");
      setShowCheckInConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Open Check Out Dialog
  const handleOpenCheckOut = async (resItem: ResidentListItem) => {
    setActionError(null);
    setCheckOutResidentTarget(resItem);
    setCheckOutDate(new Date().toISOString().slice(0, 10));
    setTargetOutstandingBalance(null);

    // Fetch financial balance for informative context
    try {
      const finRes = await fetch(`/api/finance/residents/${resItem.id}`, { cache: "no-store" });
      if (finRes.ok) {
        const finData = await finRes.json();
        setTargetOutstandingBalance(finData.summary?.outstandingRentBalance ?? 0);
      }
    } catch (err) {
      console.warn("Could not fetch balance before checkout", err);
    }
  };

  // Submit Check-Out
  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkOutResidentTarget) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/residents/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: checkOutResidentTarget.id,
          checkOutDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check out resident");

      setActionSuccess(
        `Resident ${checkOutResidentTarget.fullName} checked out successfully. Bed released.`
      );
      setCheckOutResidentTarget(null);

      if (viewHistoryResident && viewHistoryResident.id === checkOutResidentTarget.id) {
        handleViewDetails(checkOutResidentTarget.id);
      }

      await fetchData();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(err.message || "Failed to check out resident");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* ============================================================== */}
      {/* 1. HEADER (Dashboard-Consistent Luxury Styling)                */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[#8E9F89]/20">
        <div className="border-l-4 border-[#B58A57] pl-3.5">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#1A2E20]">
            Residents &amp; Stay History
          </h1>
          <p className="text-xs sm:text-sm text-[#5A6C5E] mt-1 font-sans">
            Authoritative resident directory, room assignments, stay lifecycles, and historical ledger accounts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shadow-2xs"
            title="Refresh resident records"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => handleOpenCheckInModal()}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[#B58A57]/40 bg-[#FAF8F5] hover:bg-[#FAF8F5]/80 text-[#654735] text-xs sm:text-sm font-semibold transition-all shadow-2xs"
          >
            <BedDouble className="w-4 h-4 text-[#B58A57]" />
            <span>Assign Room / Check-In</span>
          </button>

          <button
            onClick={() => {
              setActionError(null);
              setIsRegisterModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-semibold transition-all shadow-md active:scale-95"
          >
            <Plus className="w-4 h-4 text-[#B58A57]" />
            <span>Register Resident</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNERS */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2.5 shadow-2xs animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-semibold">{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center gap-2.5 shadow-2xs animate-fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center gap-2.5 shadow-2xs animate-fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. SUMMARY KPI CARDS (Tabular Numerics & Distinct Definitions)  */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        {/* Total Registered */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
            Total Registered
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums">
              {stats.total}
            </span>
          </div>
          <span className="text-xs text-[#5A6C5E] mt-2 block font-light">
            Distinct registered profiles
          </span>
        </div>

        {/* In-House Residents */}
        <div className="bg-white rounded-2xl border border-emerald-200 bg-emerald-50/20 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            In-House Residents
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-emerald-950 font-serif tabular-nums">
              {stats.active}
            </span>
          </div>
          <span className="text-xs text-emerald-700/80 mt-2 block font-light">
            Active bed occupants
          </span>
        </div>

        {/* Checked Out / Unassigned */}
        <div className="bg-white rounded-2xl border border-[#B58A57]/30 bg-[#FAF8F5] p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#654735]">
            Checked Out / Unassigned
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums">
              {stats.checkedOutTotal}
            </span>
          </div>
          <span className="text-xs text-[#654735] mt-2 block font-light">
            <span className="tabular-nums">{stats.checkedOutCount}</span> past stays &bull; <span className="tabular-nums">{stats.unassignedCount}</span> pending
          </span>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 3. SEARCH & FILTERS BAR                                        */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-3.5 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#6E7F70] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or assigned room number..."
            className="w-full pl-9 pr-4 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs sm:text-sm text-[#1A2E20] placeholder:text-[#6E7F70] focus:outline-hidden focus:border-[#1A2E20] focus:ring-1 focus:ring-[#1A2E20]"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Status:</span>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
          >
            <option value="ALL">All Residents</option>
            <option value="ACTIVE">Currently In-House (Active)</option>
            <option value="CHECKED_OUT">Checked Out (Past Stays)</option>
            <option value="UNASSIGNED">Not Assigned / Pending</option>
          </select>

          <span className="text-xs text-[#6E7F70] pl-1 font-mono tabular-nums whitespace-nowrap">
            {filteredResidents.length} of {residents.length}
          </span>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 4. REFINED RESIDENTS TABLE (Compact, Clean, Scan-Optimized)     */}
      {/* ============================================================== */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs">
          <RefreshCw className="w-6 h-6 text-[#B58A57] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[#5A6C5E]">Loading resident records from database...</p>
        </div>
      ) : filteredResidents.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center mx-auto text-[#1A2E20]">
            <Users className="w-6 h-6 text-[#B58A57]" />
          </div>
          <h3 className="font-serif text-lg text-[#1A2E20] font-bold">No Residents Found</h3>
          <p className="text-xs text-[#5A6C5E] max-w-md mx-auto">
            {residents.length === 0
              ? "No residents registered in the system yet. Click 'Register Resident' to begin."
              : "No residents match your search or filter selection."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] uppercase font-semibold tracking-wider text-[#6E7F70]">
                  <th className="py-3 px-4">Resident</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Current Room</th>
                  <th className="py-3 px-4">Current Stay</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/15 text-xs text-[#1A2E20]">
                {filteredResidents.map((res) => {
                  const isInHouse = res.status === "ACTIVE" && Boolean(res.currentRoomNumber);
                  const isCheckedOut = !isInHouse && (res.totalStayCount ?? 0) > 0;

                  return (
                    <tr
                      key={res.id}
                      className="hover:bg-[#FAF8F5]/60 transition-colors group"
                    >
                      {/* Column 1: Resident Name & Avatar */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#1A2E20] text-[#B58A57] flex items-center justify-center font-serif font-bold text-xs shrink-0 shadow-2xs">
                            {res.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <button
                              onClick={() => handleViewDetails(res.id)}
                              className="font-bold text-xs text-[#1A2E20] hover:text-[#B58A57] transition-colors text-left truncate block max-w-[200px]"
                              title="Click to view profile & stay history"
                            >
                              {res.fullName}
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Contact Info */}
                      <td className="py-3 px-4 text-[#445448]">
                        <div className="space-y-0.5">
                          <p className="flex items-center gap-1.5 font-mono tabular-nums text-[11px]">
                            <Phone className="w-3 h-3 text-[#B58A57] shrink-0" />
                            <span>{res.phone}</span>
                          </p>
                          {res.email && (
                            <p className="flex items-center gap-1.5 text-[11px] text-[#5E7060] truncate max-w-[180px]">
                              <Mail className="w-3 h-3 text-[#6E7F70] shrink-0" />
                              <span className="truncate">{res.email}</span>
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Column 3: Current Room & Readable Floor Label */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isInHouse ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs font-semibold text-[#1A2E20]">
                            <BedDouble className="w-3.5 h-3.5 text-[#B58A57] shrink-0" />
                            <span className="tabular-nums">
                              Room {res.currentRoomNumber}{" "}
                              <span className="text-[11px] font-normal text-[#5A6C5E]">
                                ({formatFloorLabel(res.currentFloor)})
                              </span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-[#8E9F89] italic font-light">
                            Not assigned
                          </span>
                        )}
                      </td>

                      {/* Column 4: Current Stay Date */}
                      <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-[#5A6C5E] whitespace-nowrap">
                        {isInHouse && res.checkInDate ? res.checkInDate : "—"}
                      </td>

                      {/* Column 5: Status Badge */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {isInHouse ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            <span>In-House</span>
                          </span>
                        ) : isCheckedOut ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-700 border border-stone-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                            <span>Checked Out</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            <span>Not Assigned</span>
                          </span>
                        )}
                      </td>

                      {/* Column 6: Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {/* View Details Button */}
                          <button
                            onClick={() => handleViewDetails(res.id)}
                            className="p-1.5 rounded-lg border border-[#8E9F89]/30 text-[#1A2E20] hover:bg-[#FAF8F5] transition-colors shadow-2xs"
                            title="View resident profile & stay history"
                          >
                            <History className="w-3.5 h-3.5 text-[#B58A57]" />
                          </button>

                          {/* Edit Profile Button */}
                          <button
                            onClick={() => handleOpenEdit(res.id)}
                            className="p-1.5 rounded-lg border border-[#8E9F89]/30 text-[#1A2E20] hover:bg-[#FAF8F5] transition-colors shadow-2xs"
                            title="Edit resident profile"
                          >
                            <UserCog className="w-3.5 h-3.5 text-[#6E7F70]" />
                          </button>

                          {/* Check-In action if unassigned */}
                          {!isInHouse && (
                            <button
                              onClick={() => handleOpenCheckInModal(res.id)}
                              className="px-2.5 py-1 rounded-lg bg-[#FAF8F5] border border-[#B58A57]/40 text-[#654735] text-xs font-semibold hover:bg-[#B58A57]/15 transition-colors shadow-2xs"
                            >
                              Assign Room
                            </button>
                          )}

                          {/* Check-Out action if in-house */}
                          {isInHouse && (
                            <button
                              onClick={() => handleOpenCheckOut(res)}
                              className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition-colors shadow-2xs"
                            >
                              Check Out
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: RESIDENT DETAILS VIEW & STAY HISTORY (Dual Area)      */}
      {/* ============================================================== */}
      {viewHistoryResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-xl w-full p-6 shadow-2xl space-y-5 animate-scale-in max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#1A2E20] text-[#B58A57] flex items-center justify-center font-serif font-bold text-base shadow-2xs shrink-0">
                  {viewHistoryResident.fullName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-serif text-2xl font-bold text-[#1A2E20] tracking-tight">
                    {viewHistoryResident.fullName}
                  </h3>
                  <p className="text-xs text-[#5A6C5E] font-mono tabular-nums">
                    {viewHistoryResident.phone}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewHistoryResident(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* AREA 1: RESIDENT PROFILE & CURRENT STATUS */}
            <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-[#8E9F89]/25 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
                  Resident Profile Details
                </span>
                <button
                  onClick={() => handleOpenEdit(viewHistoryResident.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-[#8E9F89]/30 text-xs font-semibold text-[#1A2E20] hover:bg-[#FAF8F5] shadow-2xs transition-colors"
                >
                  <Edit3 className="w-3 h-3 text-[#B58A57]" />
                  <span>Edit Profile</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[#6E7F70] block text-[10px] uppercase font-semibold">
                    Email Address
                  </span>
                  <span className="font-medium text-[#1A2E20] truncate block">
                    {viewHistoryResident.email || "—"}
                  </span>
                </div>

                <div>
                  <span className="text-[#6E7F70] block text-[10px] uppercase font-semibold">
                    Emergency Contact
                  </span>
                  <span className="font-medium text-[#1A2E20] font-mono tabular-nums">
                    {viewHistoryResident.emergencyContact || "—"}
                  </span>
                </div>

                <div className="col-span-2">
                  <span className="text-[#6E7F70] block text-[10px] uppercase font-semibold">
                    Notes &amp; Preferences
                  </span>
                  <p className="font-medium text-[#1A2E20] text-xs mt-0.5">
                    {viewHistoryResident.notes || "No special notes recorded."}
                  </p>
                </div>
              </div>

              {/* Current Active Room Assignment if in-house */}
              {viewHistoryResident.currentRoom ? (
                <div className="pt-2 border-t border-[#8E9F89]/20 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold block">
                      Active Accommodation
                    </span>
                    <span className="font-bold text-xs text-[#1A2E20] tabular-nums">
                      Room {viewHistoryResident.currentRoom.roomNumber} ({formatFloorLabel(viewHistoryResident.currentRoom.floor)}) &bull; Checked In {viewHistoryResident.currentRoom.checkInDate}
                    </span>
                  </div>
                  <span className="text-xs font-serif font-bold text-[#1A2E20] tabular-nums">
                    ₹{viewHistoryResident.currentRoom.monthlyRent.toLocaleString("en-IN")} / mo
                  </span>
                </div>
              ) : (
                <div className="pt-2 border-t border-[#8E9F89]/20 flex items-center justify-between">
                  <span className="text-xs text-[#8E9F89] italic">
                    Currently not assigned to any active room.
                  </span>
                  <button
                    onClick={() => {
                      setViewHistoryResident(null);
                      handleOpenCheckInModal(viewHistoryResident.id);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#1A2E20] text-white text-xs font-semibold hover:bg-[#263B2D]"
                  >
                    Assign Room
                  </button>
                </div>
              )}
            </div>

            {/* FINANCIAL STATEMENT SUMMARY STRIP */}
            {residentFinanceSummary && (
              <div className="p-3.5 rounded-2xl bg-white border border-[#8E9F89]/25 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
                    Financial Statement
                  </span>
                  <Link
                    href="/finance"
                    className="text-[11px] text-[#1A2E20] hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    <span>View in Finance Portal</span>
                    <ArrowRight className="w-3 h-3 text-[#B58A57]" />
                  </Link>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-[#FAF8F5] p-2 rounded-xl border border-[#8E9F89]/20">
                    <span className="text-[10px] text-[#6E7F70] block font-medium">Billed Rent</span>
                    <span className="font-bold text-[#1A2E20] tabular-nums font-serif">
                      ₹{residentFinanceSummary.totalRentCharges.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="bg-emerald-50/60 p-2 rounded-xl border border-emerald-200">
                    <span className="text-[10px] text-emerald-800 block font-medium">Rent Paid</span>
                    <span className="font-bold text-emerald-950 tabular-nums font-serif">
                      ₹{residentFinanceSummary.totalRentPaid.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="bg-[#FAF8F5] p-2 rounded-xl border border-[#B58A57]/30">
                    <span className="text-[10px] text-[#654735] block font-medium">Balance</span>
                    <span
                      className={`font-bold tabular-nums font-serif ${
                        residentFinanceSummary.outstandingRentBalance > 0
                          ? "text-rose-700"
                          : "text-emerald-800"
                      }`}
                    >
                      ₹{residentFinanceSummary.outstandingRentBalance.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-[#5A6C5E] flex items-center justify-between pt-1">
                  <span>Security Deposit Held:</span>
                  <span className="font-bold text-[#1A2E20] tabular-nums font-serif">
                    ₹{residentFinanceSummary.totalSecurityDepositHeld.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            )}

            {/* AREA 2: STAY HISTORY (Newest First) */}
            <div className="space-y-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] block">
                Stay History ({viewHistoryResident.stays.length})
              </span>

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {viewHistoryResident.stays.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#8E9F89] italic bg-[#FAF8F5] rounded-xl border border-dashed border-[#8E9F89]/30">
                    No historical stays recorded yet.
                  </div>
                ) : (
                  viewHistoryResident.stays.map((stay) => {
                    const isCurrent = stay.status === "ACTIVE";

                    return (
                      <div
                        key={stay.id}
                        className={`p-3 rounded-xl border text-xs space-y-1.5 transition-all ${
                          isCurrent
                            ? "bg-emerald-50/50 border-emerald-200 text-emerald-950"
                            : "bg-[#FAF8F5] border-[#8E9F89]/20 text-[#1A2E20]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs tabular-nums">
                            Room {stay.roomNumber} ({formatFloorLabel(stay.floor)})
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                              isCurrent
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : "bg-stone-100 text-stone-700 border-stone-200"
                            }`}
                          >
                            {isCurrent ? "Active Stay" : "Completed"}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-[#5A6C5E]">
                          <p>
                            <strong>Check-In:</strong>{" "}
                            <span className="font-mono tabular-nums">{stay.checkInDate}</span>
                          </p>
                          <p>
                            <strong>Check-Out:</strong>{" "}
                            <span className="font-mono tabular-nums">
                              {stay.checkOutDate || "Present"}
                            </span>
                          </p>
                          <p>
                            <strong>Agreed Rent:</strong>{" "}
                            <span className="tabular-nums font-semibold text-[#1A2E20]">
                              ₹{stay.monthlyRent.toLocaleString("en-IN")} / mo
                            </span>
                          </p>
                          <p>
                            <strong>Deposit:</strong>{" "}
                            <span className="tabular-nums font-semibold text-[#1A2E20]">
                              ₹{stay.securityDeposit.toLocaleString("en-IN")}
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="pt-2 text-right border-t border-[#8E9F89]/20">
              <button
                onClick={() => setViewHistoryResident(null)}
                className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: EDIT RESIDENT PROFILE                                 */}
      {/* ============================================================== */}
      {editingResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <UserCog className="w-5 h-5 text-[#B58A57]" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Edit Resident Profile
                </h3>
              </div>
              <button
                onClick={() => {
                  setEditingResident(null);
                  setShowEditConfirm(false);
                }}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs border border-rose-200">
                {actionError}
              </div>
            )}

            {!showEditConfirm ? (
              <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Full Legal Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editProfileForm.fullName}
                    onChange={(e) =>
                      setEditProfileForm({
                        ...editProfileForm,
                        fullName: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Phone Number (10+ digits) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={editProfileForm.phone}
                    onChange={(e) =>
                      setEditProfileForm({
                        ...editProfileForm,
                        phone: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={editProfileForm.email}
                    onChange={(e) =>
                      setEditProfileForm({
                        ...editProfileForm,
                        email: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Emergency Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={editProfileForm.emergencyContact}
                    onChange={(e) =>
                      setEditProfileForm({
                        ...editProfileForm,
                        emergencyContact: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Notes &amp; Preferences
                  </label>
                  <textarea
                    rows={2}
                    value={editProfileForm.notes}
                    onChange={(e) =>
                      setEditProfileForm({
                        ...editProfileForm,
                        notes: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setEditingResident(null)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold shadow-xs"
                  >
                    Review Changes
                  </button>
                </div>
              </form>
            ) : (
              /* Confirmation Screen before Profile Save */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-2">
                  <p className="font-semibold text-[#1A2E20]">Confirm Profile Updates:</p>
                  <div className="space-y-1 text-[#5A6C5E]">
                    <p>
                      <strong>Full Name:</strong>{" "}
                      <span className="text-[#1A2E20]">{editProfileForm.fullName}</span>
                    </p>
                    <p>
                      <strong>Phone:</strong>{" "}
                      <span className="text-[#1A2E20] font-mono tabular-nums">{editProfileForm.phone}</span>
                    </p>
                    <p>
                      <strong>Email:</strong>{" "}
                      <span className="text-[#1A2E20]">{editProfileForm.email || "—"}</span>
                    </p>
                    <p>
                      <strong>Emergency Contact:</strong>{" "}
                      <span className="text-[#1A2E20] font-mono tabular-nums">{editProfileForm.emergencyContact || "—"}</span>
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
                  <strong>Historical Preservation:</strong> Updating profile details does not alter past stays, posted rent charges, payments, or audit records.
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowEditConfirm(false)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleUpdateProfile}
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold disabled:opacity-50 shadow-md"
                  >
                    {submitting ? "Saving..." : "Confirm & Save Profile"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: ASSIGN ROOM / CHECK-IN                                */}
      {/* ============================================================== */}
      {isCheckInModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <BedDouble className="w-5 h-5 text-[#B58A57]" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Assign Room &amp; Check-In
                </h3>
              </div>
              <button
                onClick={() => {
                  setIsCheckInModalOpen(false);
                  setShowCheckInConfirm(false);
                }}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs border border-rose-200">
                {actionError}
              </div>
            )}

            {!showCheckInConfirm ? (
              <form onSubmit={handleCheckIn} className="space-y-3.5">
                {/* Select Resident */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Select Resident *
                  </label>
                  <select
                    required
                    value={checkInForm.residentId}
                    onChange={(e) =>
                      setCheckInForm({ ...checkInForm, residentId: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
                  >
                    <option value="">-- Choose Resident --</option>
                    {residents
                      .filter((r) => !r.currentRoomNumber || r.status === "CHECKED_OUT")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.fullName} &bull; {r.phone}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Select Available Room */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Select Room (Vacant Capacity) *
                  </label>
                  <select
                    required
                    value={checkInForm.roomId}
                    onChange={(e) => {
                      const rId = e.target.value;
                      const selected = rooms.find((rm) => rm.id === rId);
                      setCheckInForm({
                        ...checkInForm,
                        roomId: rId,
                        monthlyRent: selected ? selected.baseRentMonthly : checkInForm.monthlyRent,
                      });
                    }}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
                  >
                    <option value="">-- Choose Available Room --</option>
                    {availableRooms.map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        Room {rm.roomNumber} ({formatFloorLabel(rm.floor)}) &bull; {rm.availableBeds} bed(s) vacant &bull; ₹{rm.baseRentMonthly}/mo
                      </option>
                    ))}
                  </select>
                  {availableRooms.length === 0 && (
                    <p className="text-[11px] text-rose-600 mt-1">
                      No rooms currently have available bed capacity.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Check-In Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={checkInForm.checkInDate}
                    onChange={(e) =>
                      setCheckInForm({ ...checkInForm, checkInDate: e.target.value })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                      Agreed Rent (₹/mo) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      required
                      value={checkInForm.monthlyRent}
                      onChange={(e) =>
                        setCheckInForm({
                          ...checkInForm,
                          monthlyRent: Number(e.target.value),
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                      Security Deposit (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="500"
                      value={checkInForm.securityDeposit}
                      onChange={(e) =>
                        setCheckInForm({
                          ...checkInForm,
                          securityDeposit: Number(e.target.value),
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsCheckInModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={availableRooms.length === 0}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Review Check-In
                  </button>
                </div>
              </form>
            ) : (
              /* Check-In Confirmation Step */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-2">
                  <p className="font-semibold text-[#1A2E20]">Confirm Assignment Details:</p>
                  <div className="space-y-1 text-[#5A6C5E]">
                    <p>
                      <strong>Resident:</strong>{" "}
                      <span className="text-[#1A2E20]">
                        {residents.find((r) => r.id === checkInForm.residentId)?.fullName}
                      </span>
                    </p>
                    <p>
                      <strong>Target Room:</strong>{" "}
                      <span className="text-[#1A2E20] font-bold tabular-nums">
                        Room {rooms.find((rm) => rm.id === checkInForm.roomId)?.roomNumber} ({formatFloorLabel(rooms.find((rm) => rm.id === checkInForm.roomId)?.floor)})
                      </span>
                    </p>
                    <p>
                      <strong>Check-In Date:</strong>{" "}
                      <span className="text-[#1A2E20] font-mono tabular-nums">{checkInForm.checkInDate}</span>
                    </p>
                    <p>
                      <strong>Monthly Rent:</strong>{" "}
                      <span className="text-[#1A2E20] tabular-nums font-bold">
                        ₹{Number(checkInForm.monthlyRent).toLocaleString("en-IN")} / mo
                      </span>
                    </p>
                    <p>
                      <strong>Security Deposit:</strong>{" "}
                      <span className="text-[#1A2E20] tabular-nums">
                        ₹{Number(checkInForm.securityDeposit || 0).toLocaleString("en-IN")}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-950 leading-relaxed">
                  <strong>Atomic Capacity Check:</strong> Committing will assign 1 bed in this room. Capacity and active stay limits are verified transactionally.
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowCheckInConfirm(false)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleCheckIn}
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold disabled:opacity-50 shadow-md"
                  >
                    {submitting ? "Processing..." : "Confirm & Check In"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 4: CHECK-OUT CONFIRMATION DIALOG                         */}
      {/* ============================================================== */}
      {checkOutResidentTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <LogOut className="w-5 h-5 text-amber-700" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Check Out Resident
                </h3>
              </div>
              <button
                onClick={() => setCheckOutResidentTarget(null)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs border border-rose-200">
                {actionError}
              </div>
            )}

            <div className="bg-[#FAF8F5] p-3.5 rounded-2xl border border-[#8E9F89]/20 space-y-1.5 text-xs text-[#1A2E20]">
              <div className="flex justify-between">
                <span className="text-[#5A6C5E]">Resident:</span>
                <strong className="text-[#1A2E20]">{checkOutResidentTarget.fullName}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5A6C5E]">Current Room:</span>
                <strong className="text-[#1A2E20] tabular-nums">
                  Room {checkOutResidentTarget.currentRoomNumber} ({formatFloorLabel(checkOutResidentTarget.currentFloor)})
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5A6C5E]">Check-In Date:</span>
                <span className="font-mono tabular-nums text-[#1A2E20]">
                  {checkOutResidentTarget.checkInDate}
                </span>
              </div>
              {targetOutstandingBalance !== null && (
                <div className="flex justify-between pt-1 border-t border-[#8E9F89]/15">
                  <span className="text-[#5A6C5E]">Outstanding Rent Balance:</span>
                  <span
                    className={`font-bold tabular-nums font-serif ${
                      targetOutstandingBalance > 0 ? "text-amber-800" : "text-emerald-800"
                    }`}
                  >
                    ₹{targetOutstandingBalance.toLocaleString("en-IN")}
                  </span>
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
              <strong>Capacity Release:</strong> Confirming check-out completes this stay, immediately releases 1 bed in Room {checkOutResidentTarget.currentRoomNumber} back to available inventory, and strictly preserves all historical billing, meal, delivery, and audit records.
            </div>

            <form onSubmit={handleCheckOut} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Official Check-Out Date *
                </label>
                <input
                  type="date"
                  required
                  value={checkOutDate}
                  onChange={(e) => setCheckOutDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCheckOutResidentTarget(null)}
                  className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold disabled:opacity-50 shadow-md"
                >
                  {submitting ? "Checking out..." : "Confirm Check-Out"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 5: REGISTER NEW RESIDENT                                  */}
      {/* ============================================================== */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[#B58A57]" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Register New Resident
                </h3>
              </div>
              <button
                onClick={() => setIsRegisterModalOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-800 text-xs border border-rose-200">
                {actionError}
              </div>
            )}

            <form onSubmit={handleRegisterResident} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Full Legal Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={registerForm.fullName}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, fullName: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Phone Number (10+ digits) *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={registerForm.phone}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, phone: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Email Address (Optional)
                </label>
                <input
                  type="email"
                  placeholder="e.g. rahul@example.com"
                  value={registerForm.email}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, email: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Emergency Contact (Optional)
                </label>
                <input
                  type="tel"
                  placeholder="e.g. Father: 9811223344"
                  value={registerForm.emergencyContact}
                  onChange={(e) =>
                    setRegisterForm({
                      ...registerForm,
                      emergencyContact: e.target.value,
                    })
                  }
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Notes / Preferences (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Panasonic India employee, vegetarian"
                  value={registerForm.notes}
                  onChange={(e) =>
                    setRegisterForm({ ...registerForm, notes: e.target.value })
                  }
                  className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold shadow-md disabled:opacity-50"
                >
                  {submitting ? "Registering..." : "Save Resident"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
