"use client";

import { friendlyError } from "@/lib/friendlyError";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { RowMenu } from "@/components/ui/RowMenu";
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
  ArrowRightLeft,
} from "lucide-react";
import {
  ResidentListItem,
  ResidentDetail,
  RoomWithOccupancy,
  ResidentFinancialSummary,
  ResidentStayRecord,
  ResidentSettlementPreview,
  ResidentSettlementDeduction,
  PaymentMethod,
  CANONICAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
} from "@/types";
import { ResidentKycSection } from "@/modules/residents/components/ResidentKycSection";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { SettlementApprovals } from "@/modules/residents/SettlementApprovals";
import { businessToday } from "@/lib/businessDate";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { PageHeader, StatStrip, Card, SearchField, EmptyState, Badge } from "@/components/ui/kit";
import { RefreshButton } from "@/components/ui/states";
import { formatNumberIN } from "@/lib/format";

import { PhoneError } from "@/components/forms/PhoneError";
import { PhoneOrDesktop, useIsPhone } from "@/components/app/m";
import { ResidentsMobile } from "@/modules/residents/ResidentsMobile";
/**
 * Maps database floor integer to human-readable full label.
 */
function formatFloorLabel(floor: number | null | undefined): string {
  if (floor === null || floor === undefined) return "";
  if (floor === 0) return "Ground Floor";
  return `Floor ${floor}`;
}

export default function ResidentsPage() {
  const {
    data: residentsData,
    error: residentsQueryError,
    isLoading: isResidentsLoading,
    isRevalidating: isResidentsRevalidating,
    refetch: refetchResidents,
  } = useErpQuery<{ residents: ResidentListItem[]; rooms: RoomWithOccupancy[] }>(
    "/api/residents-and-rooms",
    async () => {
      const [resResidents, resRooms] = await Promise.all([
        fetch("/api/residents", { cache: "no-store" }),
        fetch("/api/rooms", { cache: "no-store" }),
      ]);
      const dataResidents = await resResidents.json();
      const dataRooms = await resRooms.json();
      if (!resResidents.ok) throw new Error(dataResidents.error || "Failed to load residents");
      if (!resRooms.ok) throw new Error(dataRooms.error || "Failed to load rooms");
      return {
        residents: dataResidents.residents || [],
        rooms: dataRooms.rooms || [],
      };
    },
    // Reference data: reused across visits for 5 min; resident/room mutations invalidate it at once.
    { ttl: 300000, tags: ["residents", "rooms"] }
  );

  const residents = residentsData?.residents || [];
  const rooms = residentsData?.rooms || [];
  const loading = isResidentsLoading && residents.length === 0;
  const isRevalidating = isResidentsRevalidating;
  const [errorOverride, setErrorOverride] = useState<string | null>(null);
  const error = errorOverride || (residentsQueryError ? residentsQueryError.message : null);
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<
    "ALL" | "ACTIVE" | "CHECKED_OUT"
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
    checkInDate: businessToday(),
    monthlyRent: 8500,
    securityDeposit: 5000,
  });
  const [showCheckInConfirm, setShowCheckInConfirm] = useState(false);

  // 3. Check-Out Modal
  const [checkOutResidentTarget, setCheckOutResidentTarget] = useState<ResidentListItem | null>(null);
  const [checkOutDate, setCheckOutDate] = useState(
    businessToday()
  );
  const [targetOutstandingBalance, setTargetOutstandingBalance] = useState<number | null>(null);
  const [settlementPreview, setSettlementPreview] = useState<ResidentSettlementPreview | null>(null);
  const [loadingSettlementPreview, setLoadingSettlementPreview] = useState(false);
  const [deductions, setDeductions] = useState<ResidentSettlementDeduction[]>([]);
  const [newDeductionReason, setNewDeductionReason] = useState("");
  const [newDeductionAmount, setNewDeductionAmount] = useState("");
  const [depositAppliedAmount, setDepositAppliedAmount] = useState(0);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<PaymentMethod>("UPI");
  const [refundReference, setRefundReference] = useState("");
  const [remainingPaymentMethod, setRemainingPaymentMethod] = useState<PaymentMethod>("UPI");
  const [remainingPaymentReference, setRemainingPaymentReference] = useState("");
  const [recordRemainingPaymentNow, setRecordRemainingPaymentNow] = useState(false);
  const [settlementNotes, setSettlementNotes] = useState("");

  // 4. Resident Detail View & Stay History Modal
  const [viewHistoryResident, setViewHistoryResident] = useState<ResidentDetail | null>(null);
  const [residentFinanceSummary, setResidentFinanceSummary] = useState<ResidentFinancialSummary | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // A modal frame shown the moment a resident is opened, while the details load.
  const [opening, setOpening] = useState<{ name: string; what: string } | null>(null);
  const openTicket = useRef(0);

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

  // 6. Transfer Room Modal (Task 01B.54)
  const [transferTargetResident, setTransferTargetResident] = useState<ResidentListItem | null>(null);
  const [transferForm, setTransferForm] = useState({
    targetRoomId: "",
    transferDate: businessToday(),
    newMonthlyRent: 8500,
    reason: "",
    // "" = any free bed in the destination room
    bedId: "",
  });
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);

  // ---------------------------------------------------------------------------
  // Data Fetching & Refetch
  // ---------------------------------------------------------------------------
  const fetchData = async () => {
    try {
      setErrorOverride(null);
      invalidateErpCache(["residents", "rooms", "dashboard"]);
      await refetchResidents();
    } catch (err: any) {
      setErrorOverride(err.message || "Failed to fetch data");
    }
  };

  // ---------------------------------------------------------------------------
  // Computed KPI Metrics (Accurate, Distinct Database Definitions)
  // ---------------------------------------------------------------------------
  // Residents shown: everyone in house, and those who checked out in the last 30 days. People who
  // were registered but never given a room are not listed (Check in still finds them).
  const cutoff30 = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const isInHouse = (r: ResidentListItem) => r.status === "ACTIVE" && Boolean(r.currentRoomNumber);
  const isRecentlyOut = (r: ResidentListItem) => !isInHouse(r) && (r.totalStayCount ?? 0) > 0 && Boolean(r.lastCheckOutDate) && String(r.lastCheckOutDate) >= cutoff30;
  const stats = useMemo(() => {
    const active = residents.filter(isInHouse).length;
    const checkedOutCount = residents.filter(isRecentlyOut).length;
    return { total: active + checkedOutCount, active, checkedOutCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residents, cutoff30]);

  // ---------------------------------------------------------------------------
  // Filtered Residents List
  // ---------------------------------------------------------------------------
  const phone = useIsPhone();
  const filteredResidents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return residents.filter((r) => {
      const inHouse = isInHouse(r);
      const out = isRecentlyOut(r);
      if (!inHouse && !out) return false;
      const matchesSearch =
        term === "" ||
        r.fullName.toLowerCase().includes(term) ||
        r.phone.includes(term) ||
        (r.currentRoomNumber && r.currentRoomNumber.toLowerCase().includes(term));
      const matchesStatus = selectedStatus === "ALL" || (selectedStatus === "ACTIVE" && inHouse) || (selectedStatus === "CHECKED_OUT" && out);
      return matchesSearch && matchesStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residents, search, selectedStatus]);

  // Available rooms with vacant capacity
  const availableRooms = useMemo(() => {
    return rooms.filter((r) => r.isActive && r.availableBeds > 0);
  }, [rooms]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  // Open Detailed Resident View & Stay History
  const handleViewDetails = async (residentId: string, name?: string) => {
    setLoadingHistory(true);
    setViewHistoryResident(null);
    setResidentFinanceSummary(null);
    const ticket = ++openTicket.current;
    setOpening({ name: name || "Resident", what: "Profile and stay history" });

    try {
      const [res, finRes] = await Promise.all([
        fetch(`/api/residents/${residentId}`, { cache: "no-store" }),
        fetch(`/api/finance/residents/${residentId}`, { cache: "no-store" }),
      ]);
      const data = await res.json();
      if (ticket !== openTicket.current) return; // closed while loading
      if (!res.ok) throw new Error(data.error || "Failed to load stay history");
      setViewHistoryResident(data.resident);

      if (finRes.ok) {
        const finData = await finRes.json();
        setResidentFinanceSummary(finData.summary || null);
      }
    } catch (err: any) {
      if (ticket === openTicket.current) setActionError(friendlyError(err.message || "Could not open this resident. Try again."));
    } finally {
      if (ticket === openTicket.current) {
        setLoadingHistory(false);
        setOpening(null);
      }
    }
  };

  // Open Edit Resident Modal (from table row or from details view)
  const handleOpenEdit = async (residentId: string, name?: string) => {
    setActionError(null);
    setShowEditConfirm(false);
    const ticket = ++openTicket.current;
    setOpening({ name: name || "Resident", what: "Edit profile" });

    try {
      const res = await fetch(`/api/residents/${residentId}`, { cache: "no-store" });
      const data = await res.json();
      if (ticket !== openTicket.current) return; // closed while loading
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
      if (ticket === openTicket.current) setActionError(friendlyError(err.message || "Failed to fetch resident details"));
    } finally {
      if (ticket === openTicket.current) setOpening(null);
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
      setActionError(friendlyError(err.message || "Failed to update profile"));
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
      setActionError(friendlyError(err.message || "Failed to register resident"));
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
      checkInDate: businessToday(),
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
      setActionError(friendlyError(err.message || "Failed to check in resident"));
      setShowCheckInConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  // Calculation helpers for checkout settlement
  const totalDeductionsAmount = useMemo(() => {
    return deductions.reduce((sum, d) => sum + d.amount, 0);
  }, [deductions]);

  const availableDepositAfterDeductions = useMemo(() => {
    if (!settlementPreview) return 0;
    return Math.max(0, settlementPreview.totalDepositHeld - totalDeductionsAmount);
  }, [settlementPreview, totalDeductionsAmount]);

  useEffect(() => {
    if (settlementPreview) {
      const suggestedApplied = Math.min(
        settlementPreview.outstandingRentDue,
        availableDepositAfterDeductions
      );
      setDepositAppliedAmount(suggestedApplied);
    }
  }, [settlementPreview, availableDepositAfterDeductions]);

  const calculatedRefundAmount = useMemo(() => {
    return Math.max(0, availableDepositAfterDeductions - depositAppliedAmount);
  }, [availableDepositAfterDeductions, depositAppliedAmount]);

  const calculatedRemainingRentPayable = useMemo(() => {
    if (!settlementPreview) return 0;
    return Math.max(0, settlementPreview.outstandingRentDue - depositAppliedAmount);
  }, [settlementPreview, depositAppliedAmount]);

  const fetchSettlementPreview = async (residentId: string, date: string) => {
    setLoadingSettlementPreview(true);
    try {
      const res = await fetch(
        `/api/residents/check-out/preview?residentId=${encodeURIComponent(residentId)}&checkOutDate=${encodeURIComponent(date)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setSettlementPreview(data.preview);
        setTargetOutstandingBalance(data.preview.outstandingRentDue);
      } else {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || "Failed to load settlement preview.");
      }
    } catch (err: any) {
      console.warn("Could not fetch preview", err);
    } finally {
      setLoadingSettlementPreview(false);
    }
  };

  // Open Check Out Dialog
  const handleOpenCheckOut = async (resItem: ResidentListItem) => {
    setActionError(null);
    setCheckOutResidentTarget(resItem);
    const today = businessToday();
    setCheckOutDate(today);
    setDeductions([]);
    setNewDeductionReason("");
    setNewDeductionAmount("");
    setRefundPaymentMethod("UPI");
    setRefundReference("");
    setRemainingPaymentMethod("UPI");
    setRemainingPaymentReference("");
    setRecordRemainingPaymentNow(false);
    setSettlementNotes("");
    await fetchSettlementPreview(resItem.id, today);
  };

  const handleAddDeduction = () => {
    const reason = newDeductionReason.trim();
    const amount = parseInt(newDeductionAmount, 10);
    if (!reason) {
      setActionError("Please provide a reason for the deduction.");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setActionError("Please enter a valid positive integer amount for the deduction.");
      return;
    }
    const potentialTotal = totalDeductionsAmount + amount;
    if (settlementPreview && potentialTotal > settlementPreview.totalDepositHeld) {
      setActionError(
        `Total deductions (₹${formatNumberIN(potentialTotal)}) cannot exceed security deposit held (₹${formatNumberIN(settlementPreview.totalDepositHeld)}).`
      );
      return;
    }
    setDeductions((prev) => [...prev, { reason, amount }]);
    setNewDeductionReason("");
    setNewDeductionAmount("");
    setActionError(null);
  };

  const handleRemoveDeduction = (index: number) => {
    setDeductions((prev) => prev.filter((_, i) => i !== index));
    setActionError(null);
  };

  // Submit Check-Out & Settlement
  const handleCheckOut = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkOutResidentTarget) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const payload = {
        finalizeSettlement: true,
        residentId: checkOutResidentTarget.id,
        checkOutDate,
        deductions,
        depositAppliedAmount,
        refundAmount: calculatedRefundAmount,
        refundPaymentMethod: calculatedRefundAmount > 0 ? refundPaymentMethod : undefined,
        refundReference: calculatedRefundAmount > 0 ? refundReference.trim() || undefined : undefined,
        remainingPayableAmount: calculatedRemainingRentPayable,
        paymentMethod:
          calculatedRemainingRentPayable > 0 && recordRemainingPaymentNow
            ? remainingPaymentMethod
            : undefined,
        paymentReference:
          calculatedRemainingRentPayable > 0 && recordRemainingPaymentNow
            ? remainingPaymentReference.trim() || undefined
            : undefined,
        notes: settlementNotes.trim() || undefined,
      };

      const res = await fetch("/api/residents/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check out resident");

      setActionSuccess(
        data.pendingApproval
          ? `Settlement for ${checkOutResidentTarget.fullName} sent to the Owner for approval. They stay checked in until it is approved.`
          : `Resident ${checkOutResidentTarget.fullName} checked out and settlement finalized successfully. Bed in Room ${checkOutResidentTarget.currentRoomNumber} released.`
      );
      setCheckOutResidentTarget(null);

      if (viewHistoryResident && viewHistoryResident.id === checkOutResidentTarget.id) {
        handleViewDetails(checkOutResidentTarget.id);
      }

      await fetchData();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(friendlyError(err.message || "Failed to finalize checkout and settlement"));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Room Transfer Handlers (Task 01B.54)
  // ---------------------------------------------------------------------------
  const handleOpenTransferModal = (res: ResidentListItem) => {
    setActionError(null);
    setActionSuccess(null);
    setTransferTargetResident(res);
    // Find available active rooms excluding the resident's current room
    const availableRooms = rooms.filter(
      (r) => r.isActive && r.availableBeds > 0 && r.roomNumber !== res.currentRoomNumber
    );
    const initialTarget = availableRooms.length > 0 ? availableRooms[0] : null;
    setTransferForm({
      targetRoomId: initialTarget ? initialTarget.id : "",
      transferDate: businessToday(),
      newMonthlyRent: initialTarget ? initialTarget.baseRentMonthly : 8500,
      reason: "",
      bedId: "",
    });
    setShowTransferConfirm(false);
  };

  const handleTargetRoomChange = (roomId: string) => {
    const rm = rooms.find((r) => r.id === roomId);
    setTransferForm((prev) => ({
      ...prev,
      targetRoomId: roomId,
      newMonthlyRent: rm ? rm.baseRentMonthly : prev.newMonthlyRent,
      bedId: "",
    }));
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferTargetResident) return;
    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/residents/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: transferTargetResident.id,
          targetRoomId: transferForm.targetRoomId,
          transferDate: transferForm.transferDate,
          newMonthlyRent: Number(transferForm.newMonthlyRent),
          reason: transferForm.reason.trim(),
          bedId: transferForm.bedId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to transfer resident room.");
      }

      setActionSuccess(
        `Successfully transferred ${transferTargetResident.fullName} from Room ${data.transfer.previousRoomNumber} to Room ${data.transfer.newRoomNumber}.`
      );
      setTransferTargetResident(null);

      if (viewHistoryResident && viewHistoryResident.id === transferTargetResident.id) {
        handleViewDetails(transferTargetResident.id);
      }

      await fetchData();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(friendlyError(err.message || "Failed to transfer room."));
    } finally {
      setSubmitting(false);
      setShowTransferConfirm(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-5 min-w-0">
      <PhoneOrDesktop
        phone={phone}
        mobile={
          <ResidentsMobile
            residents={filteredResidents}
            allCount={residents.length}
            loading={loading}
            stats={stats}
            search={search}
            setSearch={setSearch}
            status={selectedStatus}
            setStatus={setSelectedStatus}
            floorLabel={formatFloorLabel}
            success={actionSuccess}
            error={actionError || error}
            approvals={<SettlementApprovals onDecided={() => fetchData()} />}
            onRegister={() => {
              setActionError(null);
              setIsRegisterModalOpen(true);
            }}
            onCheckIn={(id) => handleOpenCheckInModal(id)}
            onCheckOut={(r) => handleOpenCheckOut(r)}
            onProfile={(r) => handleViewDetails(r.id, r.fullName)}
            onEdit={(r) => handleOpenEdit(r.id, r.fullName)}
            onMove={(r) => handleOpenTransferModal(r)}
          />
        }
        desktop={
          <div className="space-y-5 min-w-0">
      <PageHeader
        title="Residents"
        actions={
          <>
            <RefreshButton onRefresh={fetchData} busy={loading || isRevalidating} label="Refresh residents" />
            <button type="button" onClick={() => handleOpenCheckInModal()} className="rn-btn">
              <BedDouble /> Check in
            </button>
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setIsRegisterModalOpen(true);
              }}
              className="rn-btn rn-btn-primary"
            >
              <Plus /> Register resident
            </button>
          </>
        }
      />

      <SettlementApprovals onDecided={() => fetchData()} />

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

      <StatStrip
        items={[
          { label: "In house", value: stats.active, tone: "good" },
          { label: "Checked out", value: stats.checkedOutCount, note: "last 30 days" },
          { label: "Listed", value: stats.total },
        ]}
      />

      <Card flush className="rn-mflat">
        <div className="p-4 sm:p-5 flex flex-wrap items-center gap-2.5 border-b border-[var(--rn-line)]">
          <SearchField value={search} onChange={setSearch} placeholder="Search name, phone or room" className="flex-1 basis-[240px]" />
          <div className="flex items-center gap-3">
            <AppSelect value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value as any)} aria-label="Status" className="rn-input">
              <option value="ALL">All residents</option>
              <option value="ACTIVE">In house</option>
              <option value="CHECKED_OUT">Checked out</option>
            </AppSelect>
            <span className="text-[12.5px] text-[var(--rn-ink-3)] tabular-nums whitespace-nowrap">{filteredResidents.length}/{stats.total}</span>
          </div>
        </div>
      {loading ? (
        <BikeLoader tone="forest" label="Loading residents…" className="py-12" />
      ) : filteredResidents.length === 0 ? (
        <EmptyState title={residents.length === 0 ? "No residents yet" : "No residents match"} />
      ) : (
            <table className="rn-table rn-mcards">
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>Contact</th>
                  <th>Room</th>
                  <th>Since</th>
                  <th>Status</th>
                  <th className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredResidents.map((res) => {
                  const isInHouse = res.status === "ACTIVE" && Boolean(res.currentRoomNumber);
                  const isCheckedOut = !isInHouse && (res.totalStayCount ?? 0) > 0;

                  return (
                    <tr key={res.id} className="sm:h-[64px]">
                      {/* Column 1: Resident Name & Avatar */}
                      <td data-m="title">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)] flex items-center justify-center font-semibold text-[12px] shrink-0">
                            {res.fullName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <button
                              onClick={() => handleViewDetails(res.id, res.fullName)}
                              className="font-medium text-[13.5px] text-[var(--rn-ink)] hover:underline text-left break-words"
                              title="Click to view profile & stay history"
                            >
                              {res.fullName}
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: Contact Info */}
                      <td data-m="kv">
                        <div className="space-y-0.5">
                          <p className="tabular-nums">
                            <span>{res.phone}</span>
                          </p>
                          {res.email && (
                            <p className="text-[12px] text-[var(--rn-ink-3)] truncate max-w-[220px]" title={res.email}>
                              {res.email}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Column 3: Current Room & Readable Floor Label */}
                      <td data-m="kv">
                        {isInHouse ? (
                          <div className="text-[var(--rn-ink)]">
                            <span className="tabular-nums font-medium">
                              Room {res.currentRoomNumber}{" "}
                              <span className="text-[12px] font-normal text-[var(--rn-ink-3)]">
                                ({formatFloorLabel(res.currentFloor)})
                              </span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-[var(--rn-ink-3)]">—</span>
                        )}
                      </td>

                      {/* Column 4: Current Stay Date */}
                      <td data-m="kv" className="tabular-nums text-[var(--rn-ink-3)]">
                        {isInHouse && res.checkInDate ? res.checkInDate : "—"}
                      </td>

                      {/* Column 5: Status Badge */}
                      <td data-m="badge">
                        {isInHouse ? (
                          <Badge tone="good">In house</Badge>
                        ) : isCheckedOut ? (
                          <Badge>Checked out</Badge>
                        ) : (
                          <Badge tone="warn">Not assigned</Badge>
                        )}
                      </td>

                      {/* Column 6: Actions */}
                      <td data-m="actions" className="text-right">
                        {/* One main action on the row; the rest are in the ⋯ menu. */}
                        <div className="inline-flex justify-end items-center gap-1.5">
                          {/* Check-In action if unassigned */}
                          {!isInHouse && (
                            <button
                              onClick={() => handleOpenCheckInModal(res.id)}
                              className="rn-btn rn-btn-sm"
                            >
                              Assign room
                            </button>
                          )}

                          {/* Check-Out action if in-house */}
                          {isInHouse && (
                            <button
                              onClick={() => handleOpenCheckOut(res)}
                              className="rn-btn rn-btn-sm rn-btn-danger"
                            >
                              Check out
                            </button>
                          )}

                          <RowMenu
                            label={`More for ${res.fullName}`}
                            items={[
                              { key: "profile", label: "Profile and stay history", icon: <History />, onSelect: () => handleViewDetails(res.id, res.fullName) },
                              { key: "edit", label: "Edit profile", icon: <UserCog />, onSelect: () => handleOpenEdit(res.id, res.fullName) },
                              { key: "transfer", label: "Move to another room", icon: <ArrowRightLeft />, onSelect: () => handleOpenTransferModal(res), hidden: !isInHouse },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
      )}
      </Card>
          </div>
        }
      />

      {/* ============================================================== */}
      {/* MODAL 1: RESIDENT DETAILS VIEW & STAY HISTORY (Dual Area)      */}
      {/* ============================================================== */}
      {opening && !viewHistoryResident && !editingResident && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 rn-modal-scrim" onClick={() => { openTicket.current++; setOpening(null); setLoadingHistory(false); }}>
          <div className="rn-modal" role="dialog" aria-modal="true" aria-busy="true" aria-label={`${opening.what}: ${opening.name}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#1E3A2B] text-white flex items-center justify-center font-bold shrink-0">{opening.name.charAt(0).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="text-[17px] font-semibold text-[#1E2320] truncate">{opening.name}</p>
                  <p className="text-[13px] text-[#4A504B]">{opening.what}</p>
                </div>
              </div>
              <button type="button" aria-label="Close" onClick={() => { openTicket.current++; setOpening(null); setLoadingHistory(false); }} className="grid place-items-center w-11 h-11 -mr-2 rounded-full hover:bg-black/[0.05]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 pb-6 space-y-3" aria-hidden="true">
              <div className="h-16 rounded-2xl bg-[#F1EEE7] animate-pulse" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-12 rounded-xl bg-[#F1EEE7] animate-pulse" />
                <div className="h-12 rounded-xl bg-[#F1EEE7] animate-pulse" />
              </div>
              <div className="h-24 rounded-2xl bg-[#F1EEE7] animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {viewHistoryResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
          <div className="rn-modal bg-white rounded-3xl border border-[#8E9F89]/30 max-w-xl w-full p-6 shadow-2xl space-y-5 animate-scale-in max-h-[90dvh] overflow-y-auto">
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
                  <p className="text-xs text-[#5A6C5E] font-sans tabular-nums">
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
                  <span className="font-medium text-[#1A2E20] font-sans tabular-nums">
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
                <div className="pt-2 border-t border-[#8E9F89]/20 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold block">
                      Active Accommodation
                    </span>
                    <span className="font-bold text-xs text-[#1A2E20] tabular-nums">
                      Room {viewHistoryResident.currentRoom.roomNumber} ({formatFloorLabel(viewHistoryResident.currentRoom.floor)}) &bull; Checked In {viewHistoryResident.currentRoom.checkInDate}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-serif font-bold text-[#1A2E20] tabular-nums">
                      ₹{formatNumberIN(viewHistoryResident.currentRoom.monthlyRent)} / mo
                    </span>
                    <button
                      onClick={() => {
                        const matched = residents.find((r) => r.id === viewHistoryResident.id);
                        if (matched) {
                          handleOpenTransferModal(matched);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-[#B58A57]/40 text-xs font-semibold text-[#654735] hover:bg-[#B58A57]/15 shadow-2xs transition-colors"
                      title="Transfer resident to another room"
                    >
                      <ArrowRightLeft className="w-3 h-3 text-[#B58A57]" />
                      <span>Transfer</span>
                    </button>
                  </div>
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
                      ₹{formatNumberIN(residentFinanceSummary.totalRentCharges)}
                    </span>
                  </div>
                  <div className="bg-emerald-50/60 p-2 rounded-xl border border-emerald-200">
                    <span className="text-[10px] text-emerald-800 block font-medium">Rent Paid</span>
                    <span className="font-bold text-emerald-950 tabular-nums font-serif">
                      ₹{formatNumberIN(residentFinanceSummary.totalRentPaid)}
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
                      ₹{formatNumberIN(residentFinanceSummary.outstandingRentBalance)}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-[#5A6C5E] flex items-center justify-between pt-1">
                  <span>Security Deposit Held:</span>
                  <span className="font-bold text-[#1A2E20] tabular-nums font-serif">
                    ₹{formatNumberIN(residentFinanceSummary.totalSecurityDepositHeld)}
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
                            <span className="font-sans tabular-nums">{stay.checkInDate}</span>
                          </p>
                          <p>
                            <strong>Check-Out:</strong>{" "}
                            <span className="font-sans tabular-nums">
                              {stay.checkOutDate || "Present"}
                            </span>
                          </p>
                          <p>
                            <strong>Agreed Rent:</strong>{" "}
                            <span className="tabular-nums font-semibold text-[#1A2E20]">
                              ₹{formatNumberIN(stay.monthlyRent)} / mo
                            </span>
                          </p>
                          <p>
                            <strong>Deposit:</strong>{" "}
                            <span className="tabular-nums font-semibold text-[#1A2E20]">
                              ₹{formatNumberIN(stay.securityDeposit)}
                            </span>
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Government ID & KYC Section (Task 01B.57) */}
            <div className="pt-2">
              <ResidentKycSection
                residentId={viewHistoryResident.id}
                residentName={viewHistoryResident.fullName}
                canManage={true}
              />
            </div>

          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: EDIT RESIDENT PROFILE                                 */}
      {/* ============================================================== */}
      {editingResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
          <div className="rn-modal bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
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
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                  />
                  <PhoneError value={editProfileForm.phone} rule="resident" />
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
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
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
                      <span className="text-[#1A2E20] font-sans tabular-nums">{editProfileForm.phone}</span>
                    </p>
                    <p>
                      <strong>Email:</strong>{" "}
                      <span className="text-[#1A2E20]">{editProfileForm.email || "—"}</span>
                    </p>
                    <p>
                      <strong>Emergency Contact:</strong>{" "}
                      <span className="text-[#1A2E20] font-sans tabular-nums">{editProfileForm.emergencyContact || "—"}</span>
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
          <div className="rn-modal bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
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
                  <AppSelect
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
                  </AppSelect>
                </div>

                {/* Select Available Room */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Select Room (Vacant Capacity) *
                  </label>
                  <AppSelect
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
                  </AppSelect>
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
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden"
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
                      <span className="text-[#1A2E20] font-sans tabular-nums">{checkInForm.checkInDate}</span>
                    </p>
                    <p>
                      <strong>Monthly Rent:</strong>{" "}
                      <span className="text-[#1A2E20] tabular-nums font-bold">
                        ₹{formatNumberIN(Number(checkInForm.monthlyRent))} / mo
                      </span>
                    </p>
                    <p>
                      <strong>Security Deposit:</strong>{" "}
                      <span className="text-[#1A2E20] tabular-nums">
                        ₹{formatNumberIN(Number(checkInForm.securityDeposit || 0))}
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
      {/* MODAL 4: CHECKOUT & FINAL FINANCIAL SETTLEMENT                 */}
      {/* ============================================================== */}
      {checkOutResidentTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
          <div className="rn-modal rn-modal-wide bg-white rounded-3xl border border-[#8E9F89]/30 max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <LogOut className="w-5 h-5 text-amber-700" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Resident Checkout & Final Settlement
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

            {/* Resident & Room Identity Banner */}
            <div className="bg-[#FAF8F5] p-3.5 rounded-2xl border border-[#8E9F89]/20 grid grid-cols-2 gap-3 text-xs text-[#1A2E20]">
              <div>
                <span className="text-[#5A6C5E] block text-[11px]">Resident Name</span>
                <strong className="text-[#1A2E20] text-sm">{checkOutResidentTarget.fullName}</strong>
                <span className="block text-[11px] text-[#5A6C5E] mt-0.5">{checkOutResidentTarget.phone}</span>
              </div>
              <div>
                <span className="text-[#5A6C5E] block text-[11px]">Assigned Room</span>
                <strong className="text-[#1A2E20] text-sm tabular-nums">
                  Room {checkOutResidentTarget.currentRoomNumber} ({formatFloorLabel(checkOutResidentTarget.currentFloor)})
                </strong>
                <span className="block text-[11px] text-[#5A6C5E] mt-0.5">
                  Checked in: {checkOutResidentTarget.checkInDate}
                </span>
              </div>
            </div>

            <form onSubmit={handleCheckOut} className="space-y-4">
              {/* Checkout Date Input */}
              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Official Check-Out Date *
                </label>
                <input
                  type="date"
                  required
                  value={checkOutDate}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    setCheckOutDate(newDate);
                    if (checkOutResidentTarget) {
                      fetchSettlementPreview(checkOutResidentTarget.id, newDate);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden"
                />
              </div>

              {/* Settlement Preview Card */}
              {loadingSettlementPreview ? (
                <div className="p-6 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/20 text-center text-xs text-[#5A6C5E] flex items-center justify-center gap-2">
                  <BikeLoader inline tone="forest" label="Calculating" />
                  Calculating the settlement…
                </div>
              ) : settlementPreview ? (
                <div className="space-y-4">
                  {/* Financial Dossier Section */}
                  <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/25 space-y-3 text-xs">
                    <h4 className="font-semibold text-[#1A2E20] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5 text-emerald-800" />
                      1. Financial Position as of Checkout Date
                    </h4>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      {/* Rent Column */}
                      <div className="bg-white p-3 rounded-xl border border-[#8E9F89]/20 space-y-1">
                        <span className="text-[#5A6C5E] block text-[11px]">Rent Liability</span>
                        <div className="flex justify-between text-[11px]">
                          <span>Billed Charges:</span>
                          <span className="tabular-nums font-semibold">₹{formatNumberIN(settlementPreview.totalRentCharged)}</span>
                        </div>
                        <div className="flex justify-between text-[11px] text-emerald-700">
                          <span>Paid to Date:</span>
                          <span className="tabular-nums font-semibold">-₹{formatNumberIN(settlementPreview.totalRentPaid)}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-[#8E9F89]/20 font-bold text-xs">
                          <span>Outstanding Rent:</span>
                          <span className={`tabular-nums ${settlementPreview.outstandingRentDue > 0 ? "text-amber-800" : "text-emerald-800"}`}>
                            ₹{formatNumberIN(settlementPreview.outstandingRentDue)}
                          </span>
                        </div>
                      </div>

                      {/* Security Deposit Column */}
                      <div className="bg-white p-3 rounded-xl border border-[#8E9F89]/20 space-y-1">
                        <span className="text-[#5A6C5E] block text-[11px]">Security Deposit Held</span>
                        <div className="flex justify-between text-[11px]">
                          <span>Gross Deposits Held:</span>
                          <span className="tabular-nums font-semibold">₹{formatNumberIN(settlementPreview.totalDepositHeld + settlementPreview.priorRefunds)}</span>
                        </div>
                        {settlementPreview.priorRefunds > 0 && (
                          <div className="flex justify-between text-[11px] text-amber-700">
                            <span>Prior Refunds:</span>
                            <span className="tabular-nums font-semibold">-₹{formatNumberIN(settlementPreview.priorRefunds)}</span>
                          </div>
                        )}
                        <div className="flex justify-between pt-1 border-t border-[#8E9F89]/20 font-bold text-xs">
                          <span>Active Deposit Held:</span>
                          <span className="tabular-nums text-emerald-900">
                            ₹{formatNumberIN(settlementPreview.totalDepositHeld)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Deductions Section */}
                  <div className="p-4 rounded-2xl bg-white border border-[#8E9F89]/30 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-[#1A2E20] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                        <CreditCard className="w-3.5 h-3.5 text-amber-700" />
                        2. Authorized Deposit Deductions
                      </h4>
                      <span className="text-[11px] font-semibold text-[#5A6C5E]">
                        Total Deductions: <strong className="text-rose-700">₹{formatNumberIN(totalDeductionsAmount)}</strong>
                      </span>
                    </div>

                    {deductions.length > 0 ? (
                      <div className="space-y-1.5">
                        {deductions.map((ded, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/20 text-xs">
                            <span className="text-[#1A2E20] font-medium">{ded.reason}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-rose-700 tabular-nums">₹{formatNumberIN(ded.amount)}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveDeduction(idx)}
                                className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* Add Deduction Form */}
                    <div className="pt-2 border-t border-[#8E9F89]/15 flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Deduction reason (e.g. Deep cleaning, Room painting, Lost keys)"
                        value={newDeductionReason}
                        onChange={(e) => setNewDeductionReason(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="Amount (₹)"
                        value={newDeductionAmount}
                        onChange={(e) => setNewDeductionAmount(e.target.value)}
                        className="w-24 px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-lg text-xs text-[#1A2E20] tabular-nums focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={handleAddDeduction}
                        className="px-3 py-1.5 bg-[#1A2E20] text-white rounded-lg text-xs font-semibold hover:bg-[#263B2D] transition-colors"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Settlement Application & Resolution */}
                  <div className="p-4 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/25 space-y-3 text-xs">
                    <h4 className="font-semibold text-[#1A2E20] uppercase tracking-wider text-[11px]">
                      3. Settlement Resolution & Net Balance
                    </h4>

                    {/* Deposit application slider/input if outstanding rent > 0 and deposit > 0 */}
                    {settlementPreview.outstandingRentDue > 0 && availableDepositAfterDeductions > 0 && (
                      <div className="p-3 bg-white rounded-xl border border-[#8E9F89]/20 space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#5A6C5E]">Apply Deposit Towards Outstanding Rent:</span>
                          <span className="font-bold text-[#1A2E20] tabular-nums">₹{formatNumberIN(depositAppliedAmount)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={Math.min(settlementPreview.outstandingRentDue, availableDepositAfterDeductions)}
                          step={100}
                          value={depositAppliedAmount}
                          onChange={(e) => setDepositAppliedAmount(Number(e.target.value))}
                          className="w-full accent-emerald-800"
                        />
                        <div className="flex justify-between text-[10px] text-[#5A6C5E]">
                          <span>₹0 (Don't apply)</span>
                          <span>Max: ₹{formatNumberIN(Math.min(settlementPreview.outstandingRentDue, availableDepositAfterDeductions))}</span>
                        </div>
                      </div>
                    )}

                    {/* Net Refund Due Card */}
                    {calculatedRefundAmount > 0 && (
                      <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-emerald-900 text-xs">
                            Security Deposit Refund Due to Resident:
                          </span>
                          <span className="text-base font-bold text-emerald-900 font-serif tabular-nums">
                            ₹{formatNumberIN(calculatedRefundAmount)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <label className="block text-[11px] font-semibold text-emerald-950 mb-1">
                              Refund Payment Method *
                            </label>
                            <AppSelect
                              value={refundPaymentMethod}
                              onChange={(e) => setRefundPaymentMethod(e.target.value as PaymentMethod)}
                              className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
                            >
                              {CANONICAL_PAYMENT_METHODS.map((method) => (
                                <option key={method} value={method}>
                                  {PAYMENT_METHOD_LABELS[method]}
                                </option>
                              ))}
                            </AppSelect>
                          </div>
                          <div>
                            <label className="block text-[11px] font-semibold text-emerald-950 mb-1">
                              Refund Reference / UTR
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. UPI Ref / Cheque No."
                              value={refundReference}
                              onChange={(e) => setRefundReference(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Remaining Payable Card */}
                    {calculatedRemainingRentPayable > 0 && (
                      <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-900 text-xs">
                            Remaining Rent Due from Resident:
                          </span>
                          <span className="text-base font-bold text-amber-900 font-serif tabular-nums">
                            ₹{formatNumberIN(calculatedRemainingRentPayable)}
                          </span>
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer text-xs text-amber-950">
                          <input
                            type="checkbox"
                            checked={recordRemainingPaymentNow}
                            onChange={(e) => setRecordRemainingPaymentNow(e.target.checked)}
                            className="rounded accent-amber-800"
                          />
                          <span>Resident is paying this balance now at checkout</span>
                        </label>
                        {recordRemainingPaymentNow && (
                          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div>
                              <label className="block text-[11px] font-semibold text-amber-950 mb-1">
                                Payment Method *
                              </label>
                              <AppSelect
                                value={remainingPaymentMethod}
                                onChange={(e) => setRemainingPaymentMethod(e.target.value as PaymentMethod)}
                                className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
                              >
                                {CANONICAL_PAYMENT_METHODS.map((method) => (
                                  <option key={method} value={method}>
                                    {PAYMENT_METHOD_LABELS[method]}
                                  </option>
                                ))}
                              </AppSelect>
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-amber-950 mb-1">
                                Reference Number
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. Cash receipt / UPI ID"
                                value={remainingPaymentReference}
                                onChange={(e) => setRemainingPaymentReference(e.target.value)}
                                className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Zero-balance settlement notice */}
                    {calculatedRefundAmount === 0 && calculatedRemainingRentPayable === 0 && (
                      <div className="p-3 bg-stone-100 rounded-xl border border-stone-200 text-xs text-stone-700 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                        <span>Account is completely settled. No refund or additional payment required.</span>
                      </div>
                    )}
                  </div>

                  {/* Notes Field */}
                  <div>
                    <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                      Settlement Notes (Inspection, Key Handover, Remarks)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Room inspected, keys returned in good condition, settlement verified."
                      value={settlementNotes}
                      onChange={(e) => setSettlementNotes(e.target.value)}
                      className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
                    />
                  </div>
                </div>
              ) : null}

              {/* Capacity Release Assurance */}
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
                <strong>Capacity Release:</strong> Confirming checkout completes this stay, immediately releases 1 bed in Room {checkOutResidentTarget.currentRoomNumber} back to available inventory, and records an auditable settlement record.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="submit"
                  disabled={submitting || loadingSettlementPreview}
                  className="px-5 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold disabled:opacity-50 shadow-md flex items-center gap-1.5"
                >
                  {submitting ? (
                    <>
                      Finalizing…
                      Finalizing Settlement...
                    </>
                  ) : (
                    "Finalize Checkout & Settlement"
                  )}
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
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
          <div className="rn-modal bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
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
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                />
                <PhoneError value={registerForm.phone} rule="resident" />
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
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
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

      {/* ============================================================== */}
      {/* MODAL 6: ATOMIC ROOM TRANSFER (Task 01B.54)                   */}
      {/* ============================================================== */}
      {transferTargetResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
          <div className="rn-modal bg-white rounded-3xl border border-[#8E9F89]/30 max-w-lg w-full p-6 shadow-2xl space-y-4 animate-scale-in max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#B58A57]" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Transfer Resident Room
                </h3>
              </div>
              <button
                onClick={() => {
                  setTransferTargetResident(null);
                  setShowTransferConfirm(false);
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

            {/* Current Stay & Resident Summary Strip */}
            <div className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-bold text-[#1A2E20] text-sm block">
                    {transferTargetResident.fullName}
                  </span>
                  <span className="text-[#5A6C5E] font-sans tabular-nums text-[11px]">
                    {transferTargetResident.phone}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-semibold text-[#6E7F70] block">
                    Current Room
                  </span>
                  <span className="font-bold text-xs text-[#1A2E20]">
                    Room {transferTargetResident.currentRoomNumber} ({formatFloorLabel(transferTargetResident.currentFloor)})
                  </span>
                </div>
              </div>
              <div className="pt-2 border-t border-[#8E9F89]/15 flex items-center justify-between text-[11px] text-[#5A6C5E]">
                <span>Checked In: <strong className="text-[#1A2E20]">{transferTargetResident.checkInDate || "Active"}</strong></span>
                <span className="text-emerald-700 font-semibold">Security Deposit: Carried Forward</span>
              </div>
            </div>

            {!showTransferConfirm ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!transferForm.targetRoomId) {
                    setActionError("Please select a valid destination room.");
                    return;
                  }
                  if (!transferForm.reason.trim() || transferForm.reason.trim().length < 5) {
                    setActionError("Transfer reason is required (minimum 5 characters).");
                    return;
                  }
                  setActionError(null);
                  setShowTransferConfirm(true);
                }}
                className="space-y-3.5"
              >
                {/* Select Destination Room */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Destination Room *
                  </label>
                  <AppSelect
                    required
                    value={transferForm.targetRoomId}
                    onChange={(e) => handleTargetRoomChange(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                  >
                    <option value="" disabled>-- Select Destination Room --</option>
                    {rooms
                      .filter((r) => r.isActive && r.availableBeds > 0 && r.roomNumber !== transferTargetResident.currentRoomNumber)
                      .map((rm) => (
                        <option key={rm.id} value={rm.id}>
                          Room {rm.roomNumber} ({formatFloorLabel(rm.floor)}) &bull; {rm.type.replace(/_/g, " ")} &bull; {rm.availableBeds} bed(s) available &bull; ₹{formatNumberIN(rm.baseRentMonthly)}/mo
                        </option>
                      ))}
                  </AppSelect>
                  {rooms.filter((r) => r.isActive && r.availableBeds > 0 && r.roomNumber !== transferTargetResident.currentRoomNumber).length === 0 && (
                    <p className="text-[11px] text-amber-700 mt-1">
                      No other rooms currently have available beds.
                    </p>
                  )}
                </div>

                {(rooms.find((r) => r.id === transferForm.targetRoomId)?.beds?.length ?? 0) > 0 && (
                  <div>
                    <label htmlFor="transfer-bed" className="block text-xs font-semibold text-[#1A2E20] mb-1">Bed in the new room</label>
                    <AppSelect
                      id="transfer-bed"
                      value={transferForm.bedId}
                      onChange={(e) => setTransferForm({ ...transferForm, bedId: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                    >
                      <option value="">Any free bed (choose later)</option>
                      {(rooms.find((r) => r.id === transferForm.targetRoomId)?.beds ?? []).filter((b) => b.status === "IN_SERVICE" && !b.occupant).map((b) => (
                        <option key={b.id} value={b.id}>{b.label}</option>
                      ))}
                    </AppSelect>
                  </div>
                )}

                {/* Transfer Date */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Effective Transfer Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={transferForm.transferDate}
                    min={transferTargetResident.checkInDate || undefined}
                    onChange={(e) => setTransferForm({ ...transferForm, transferDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                {/* New Monthly Rent */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Monthly Rent for New Room (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step={100}
                    value={transferForm.newMonthlyRent}
                    onChange={(e) => setTransferForm({ ...transferForm, newMonthlyRent: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                {/* Transfer Reason */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Reason for Transfer * (Min. 5 characters)
                  </label>
                  <textarea
                    rows={2}
                    required
                    placeholder="e.g. Resident requested upgrade to single occupancy / Floor maintenance relocation"
                    value={transferForm.reason}
                    onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                    className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="submit"
                    disabled={submitting || rooms.filter((r) => r.isActive && r.availableBeds > 0 && r.roomNumber !== transferTargetResident.currentRoomNumber).length === 0}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold shadow-xs disabled:opacity-50"
                  >
                    Review Transfer
                  </button>
                </div>
              </form>
            ) : (
              /* Review & Confirm Screen */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-2.5">
                  <p className="font-semibold text-[#1A2E20]">Confirm Room Transfer Details:</p>
                  <div className="space-y-1.5 text-[#5A6C5E]">
                    <div className="flex items-center justify-between">
                      <span>Resident:</span>
                      <strong className="text-[#1A2E20]">{transferTargetResident.fullName}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Current Assignment:</span>
                      <strong className="text-[#1A2E20]">Room {transferTargetResident.currentRoomNumber}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Destination Assignment:</span>
                      <strong className="text-[#1A2E20]">
                        Room {rooms.find((r) => r.id === transferForm.targetRoomId)?.roomNumber || "Selected"}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Effective Transfer Date:</span>
                      <strong className="text-[#1A2E20] font-sans tabular-nums">{transferForm.transferDate}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>New Monthly Rent:</span>
                      <strong className="text-[#1A2E20] font-sans tabular-nums">
                        ₹{formatNumberIN(Number(transferForm.newMonthlyRent))} / mo
                      </strong>
                    </div>
                    <div className="pt-1.5 border-t border-[#8E9F89]/20">
                      <span className="block text-[10px] uppercase font-semibold text-[#6E7F70]">Reason:</span>
                      <span className="text-[#1A2E20] italic block mt-0.5">{transferForm.reason}</span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
                  <strong>Atomic Capacity Rebalance:</strong> Upon confirmation, Room {transferTargetResident.currentRoomNumber}&apos;s bed is immediately released and Room {rooms.find((r) => r.id === transferForm.targetRoomId)?.roomNumber}&apos;s bed is occupied. The existing security deposit is carried forward automatically.
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowTransferConfirm(false)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleTransferSubmit}
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold disabled:opacity-50 shadow-md inline-flex items-center gap-1.5"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-[#B58A57]" />
                    <span>{submitting ? "Transferring..." : "Confirm & Execute Transfer"}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
