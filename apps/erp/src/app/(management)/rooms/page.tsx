"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  BedDouble,
  Plus,
  Search,
  Filter,
  Users,
  Edit3,
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Building2,
  RefreshCw,
  Trash2,
  LogOut,
  UserCog,
  UserPlus,
  Check,
  Phone,
  Mail,
  FileText,
  Calendar,
  Layers,
  ArrowRight,
  ShieldAlert,
  User,
} from "lucide-react";
import {
  RoomWithOccupancy,
  RoomType,
  RoomOccupant,
  ResidentDetail,
  ResidentListItem,
} from "@/types";

const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  SINGLE: "Single Occupancy",
  DOUBLE_SHARING: "Double Sharing",
  TRIPLE_SHARING: "Triple Sharing",
  EXECUTIVE_SUITE: "Executive Suite",
};

/**
 * Maps database integer floor to canonical, human-readable full label.
 * Avoids awkward abbreviations like 'Ground Fl'.
 */
function formatFloorLabel(floor: number): string {
  if (floor === 0) return "Ground Floor";
  return `Floor ${floor}`;
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<RoomWithOccupancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedFloor, setSelectedFloor] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<"ALL" | "VACANT" | "OCCUPIED">("ALL");

  // Notifications & Async States
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ---------------------------------------------------------------------------
  // Modal 1: Add Room State
  // ---------------------------------------------------------------------------
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addFormData, setAddFormData] = useState({
    roomNumber: "",
    floor: 1,
    type: "DOUBLE_SHARING" as RoomType,
    capacity: 2,
    baseRentMonthly: 8500,
  });

  // ---------------------------------------------------------------------------
  // Modal 2: Edit Room State
  // ---------------------------------------------------------------------------
  const [editingRoom, setEditingRoom] = useState<RoomWithOccupancy | null>(null);
  const [editFormData, setEditFormData] = useState({
    roomNumber: "",
    floor: 1,
    type: "DOUBLE_SHARING" as RoomType,
    capacity: 2,
    baseRentMonthly: 8500,
  });
  const [showEditConfirm, setShowEditConfirm] = useState(false);

  // ---------------------------------------------------------------------------
  // Modal 3: Delete Room State
  // ---------------------------------------------------------------------------
  const [deletingRoom, setDeletingRoom] = useState<RoomWithOccupancy | null>(null);

  // ---------------------------------------------------------------------------
  // Modal 4: Edit Resident State
  // ---------------------------------------------------------------------------
  const [editingResident, setEditingResident] = useState<{
    occupant: RoomOccupant;
    room: RoomWithOccupancy;
  } | null>(null);
  const [residentFormData, setResidentFormData] = useState({
    fullName: "",
    phone: "",
    email: "",
    emergencyContact: "",
    notes: "",
  });
  const [loadingResidentDetail, setLoadingResidentDetail] = useState(false);

  // ---------------------------------------------------------------------------
  // Modal 5: Resident Check-Out State
  // ---------------------------------------------------------------------------
  const [checkingOutResident, setCheckingOutResident] = useState<{
    occupant: RoomOccupant;
    room: RoomWithOccupancy;
  } | null>(null);
  const [checkOutDate, setCheckOutDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  // ---------------------------------------------------------------------------
  // Modal 6: Add Tenant to Available Bed State
  // ---------------------------------------------------------------------------
  const [assigningRoom, setAssigningRoom] = useState<RoomWithOccupancy | null>(null);
  const [assignMode, setAssignMode] = useState<"NEW" | "EXISTING">("NEW");
  const [checkedOutResidents, setCheckedOutResidents] = useState<ResidentListItem[]>([]);
  const [loadingResidentsList, setLoadingResidentsList] = useState(false);
  const [selectedExistingResidentId, setSelectedExistingResidentId] = useState("");
  const [tenantFormData, setTenantFormData] = useState({
    fullName: "",
    phone: "",
    email: "",
    emergencyContact: "",
    notes: "",
    checkInDate: new Date().toISOString().slice(0, 10),
    monthlyRent: 8500,
    securityDeposit: 0,
  });
  const [showAssignConfirm, setShowAssignConfirm] = useState(false);

  // ---------------------------------------------------------------------------
  // Data Fetching
  // ---------------------------------------------------------------------------
  const fetchRooms = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/rooms", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load rooms");
      }
      setRooms(data.rooms || []);
    } catch (err: any) {
      setError(err.message || "Failed to fetch room inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, []);

  // Summary Metrics calculated live from SQLite records
  const stats = useMemo(() => {
    const totalRooms = rooms.length;
    const totalCapacity = rooms.reduce((acc, r) => acc + r.capacity, 0);
    const occupiedBeds = rooms.reduce((acc, r) => acc + r.occupiedBeds, 0);
    const availableBeds = rooms.reduce((acc, r) => acc + r.availableBeds, 0);
    const occupancyRate =
      totalCapacity > 0 ? Math.round((occupiedBeds / totalCapacity) * 100) : 0;
    return { totalRooms, totalCapacity, occupiedBeds, availableBeds, occupancyRate };
  }, [rooms]);

  // Unique floors for filter
  const floors = useMemo(() => {
    const unique = Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b);
    return unique;
  }, [rooms]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.filter((r) => {
      const q = search.trim().toLowerCase();
      const matchesSearch =
        q === "" ||
        r.roomNumber.toLowerCase().includes(q) ||
        r.occupants?.some((occ) => occ.fullName.toLowerCase().includes(q));

      const matchesFloor = selectedFloor === "ALL" || r.floor === Number(selectedFloor);

      const matchesStatus =
        selectedStatus === "ALL" ||
        (selectedStatus === "VACANT" && r.availableBeds > 0) ||
        (selectedStatus === "OCCUPIED" && r.occupiedBeds > 0);

      return matchesSearch && matchesFloor && matchesStatus;
    });
  }, [rooms, search, selectedFloor, selectedStatus]);

  // Duplicate Room Number Check for Add Form
  const addRoomNumberClean = addFormData.roomNumber.trim().toUpperCase();
  const isAddRoomDuplicate = useMemo(() => {
    if (!addRoomNumberClean) return false;
    return rooms.some((r) => r.roomNumber.trim().toUpperCase() === addRoomNumberClean);
  }, [rooms, addRoomNumberClean]);

  // Duplicate Room Number Check for Edit Form
  const editRoomNumberClean = editFormData.roomNumber.trim().toUpperCase();
  const isEditRoomDuplicate = useMemo(() => {
    if (!editingRoom || !editRoomNumberClean) return false;
    return rooms.some(
      (r) =>
        r.id !== editingRoom.id &&
        r.roomNumber.trim().toUpperCase() === editRoomNumberClean
    );
  }, [rooms, editingRoom, editRoomNumberClean]);

  // Capacity validation for Edit Form (cannot reduce below active occupants)
  const isEditCapacityInvalid = useMemo(() => {
    if (!editingRoom) return false;
    return editFormData.capacity < editingRoom.occupiedBeds;
  }, [editingRoom, editFormData.capacity]);

  // ---------------------------------------------------------------------------
  // Action Handlers: Add / Edit / Delete Room
  // ---------------------------------------------------------------------------
  const handleOpenAddModal = () => {
    setActionError(null);
    setAddFormData({
      roomNumber: "",
      floor: 1,
      type: "DOUBLE_SHARING",
      capacity: 2,
      baseRentMonthly: 8500,
    });
    setIsAddModalOpen(true);
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAddRoomDuplicate) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomNumber: addFormData.roomNumber.trim().toUpperCase(),
          floor: Number(addFormData.floor),
          type: addFormData.type,
          capacity: Number(addFormData.capacity),
          baseRentMonthly: Number(addFormData.baseRentMonthly),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create room");
      }

      setActionSuccess(`Room ${data.room.roomNumber} created successfully.`);
      setIsAddModalOpen(false);
      await fetchRooms();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to create room");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditRoom = (room: RoomWithOccupancy) => {
    setActionError(null);
    setEditingRoom(room);
    setEditFormData({
      roomNumber: room.roomNumber,
      floor: room.floor,
      type: room.type,
      capacity: room.capacity,
      baseRentMonthly: room.baseRentMonthly,
    });
    setShowEditConfirm(false);
  };

  const handleUpdateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom || isEditRoomDuplicate || isEditCapacityInvalid) return;

    if (!showEditConfirm) {
      setShowEditConfirm(true);
      return;
    }

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/rooms/${editingRoom.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomNumber: editFormData.roomNumber.trim().toUpperCase(),
          floor: Number(editFormData.floor),
          type: editFormData.type,
          capacity: Number(editFormData.capacity),
          baseRentMonthly: Number(editFormData.baseRentMonthly),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update room");
      }

      setActionSuccess(`Room ${data.room.roomNumber} updated successfully.`);
      setEditingRoom(null);
      setShowEditConfirm(false);
      await fetchRooms();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to update room");
      setShowEditConfirm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDeleteRoom = (room: RoomWithOccupancy) => {
    setActionError(null);
    setDeletingRoom(room);
  };

  const handleDeleteRoom = async () => {
    if (!deletingRoom) return;
    if (deletingRoom.occupiedBeds > 0) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/rooms/${deletingRoom.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete room");
      }

      setActionSuccess(`Room ${deletingRoom.roomNumber} deleted successfully.`);
      setDeletingRoom(null);
      await fetchRooms();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to delete room");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers: Edit Resident Profile
  // ---------------------------------------------------------------------------
  const handleOpenEditResident = async (
    occupant: RoomOccupant,
    room: RoomWithOccupancy
  ) => {
    setActionError(null);
    setEditingResident({ occupant, room });
    setResidentFormData({
      fullName: occupant.fullName,
      phone: occupant.phone,
      email: "",
      emergencyContact: "",
      notes: "",
    });
    setLoadingResidentDetail(true);

    try {
      const res = await fetch(`/api/residents/${occupant.residentId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.resident) {
        setResidentFormData({
          fullName: data.resident.fullName || occupant.fullName,
          phone: data.resident.phone || occupant.phone,
          email: data.resident.email || "",
          emergencyContact: data.resident.emergencyContact || "",
          notes: data.resident.notes || "",
        });
      }
    } catch (err) {
      console.warn("Could not fetch detailed resident info, using basic occupant data", err);
    } finally {
      setLoadingResidentDetail(false);
    }
  };

  const handleUpdateResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResident) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/residents/${editingResident.occupant.residentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: residentFormData.fullName.trim(),
          phone: residentFormData.phone.trim(),
          email: residentFormData.email.trim() || null,
          emergencyContact: residentFormData.emergencyContact.trim() || null,
          notes: residentFormData.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update resident");
      }

      setActionSuccess(`Resident ${data.resident.fullName} updated successfully.`);
      setEditingResident(null);
      await fetchRooms();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to update resident");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers: Resident Check-Out
  // ---------------------------------------------------------------------------
  const handleOpenCheckOutResident = (
    occupant: RoomOccupant,
    room: RoomWithOccupancy
  ) => {
    setActionError(null);
    setCheckOutDate(new Date().toISOString().slice(0, 10));
    setCheckingOutResident({ occupant, room });
  };

  const handleCheckOutResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkingOutResident) return;

    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/residents/check-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: checkingOutResident.occupant.residentId,
          checkOutDate: checkOutDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to check out resident");
      }

      setActionSuccess(
        `Resident ${checkingOutResident.occupant.fullName} checked out. Bed released in Room ${checkingOutResident.room.roomNumber}.`
      );
      setCheckingOutResident(null);
      await fetchRooms();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(err.message || "Failed to check out resident");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Action Handlers: Add Tenant directly to an Available Bed
  // ---------------------------------------------------------------------------
  const handleOpenAddTenant = async (room: RoomWithOccupancy) => {
    if (room.availableBeds <= 0) return;

    setActionError(null);
    setAssigningRoom(room);
    setAssignMode("NEW");
    setShowAssignConfirm(false);
    setSelectedExistingResidentId("");
    setTenantFormData({
      fullName: "",
      phone: "",
      email: "",
      emergencyContact: "",
      notes: "",
      checkInDate: new Date().toISOString().slice(0, 10),
      monthlyRent: room.baseRentMonthly,
      securityDeposit: 0,
    });

    // Preload checked-out residents for the "Existing Resident" selection tab
    try {
      setLoadingResidentsList(true);
      const res = await fetch("/api/residents?status=CHECKED_OUT", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.residents)) {
        setCheckedOutResidents(data.residents);
      }
    } catch (err) {
      console.warn("Could not load checked-out residents list", err);
    } finally {
      setLoadingResidentsList(false);
    }
  };

  const handleCommitAddTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningRoom) return;

    // Review step before final commit
    if (!showAssignConfirm) {
      if (assignMode === "EXISTING" && !selectedExistingResidentId) {
        setActionError("Please select an existing resident to check in.");
        return;
      }
      if (assignMode === "NEW") {
        if (!tenantFormData.fullName.trim() || tenantFormData.fullName.trim().length < 2) {
          setActionError("Full name must be at least 2 characters.");
          return;
        }
        if (!tenantFormData.phone.trim() || tenantFormData.phone.trim().length < 10) {
          setActionError("Valid phone number with at least 10 digits is required.");
          return;
        }
      }
      setActionError(null);
      setShowAssignConfirm(true);
      return;
    }

    setActionError(null);
    setSubmitting(true);

    try {
      let residentIdToAssign = selectedExistingResidentId;
      let assignedResidentName = "";

      // Step 1: If registering a new resident, persist resident profile first
      if (assignMode === "NEW") {
        const regRes = await fetch("/api/residents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: tenantFormData.fullName.trim(),
            phone: tenantFormData.phone.trim(),
            email: tenantFormData.email.trim() || null,
            emergencyContact: tenantFormData.emergencyContact.trim() || null,
            notes: tenantFormData.notes.trim() || null,
          }),
        });

        const regData = await regRes.json();
        if (!regRes.ok) {
          throw new Error(regData.error || "Failed to register new tenant profile");
        }

        residentIdToAssign = regData.resident.id;
        assignedResidentName = regData.resident.fullName;
      } else {
        const found = checkedOutResidents.find((r) => r.id === selectedExistingResidentId);
        assignedResidentName = found ? found.fullName : "Resident";
      }

      // Step 2: Perform atomic check-in into target room with server-side capacity check
      const checkInRes = await fetch("/api/residents/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: residentIdToAssign,
          roomId: assigningRoom.id,
          checkInDate: tenantFormData.checkInDate,
          monthlyRent: Number(tenantFormData.monthlyRent),
          securityDeposit: Number(tenantFormData.securityDeposit || 0),
        }),
      });

      const checkInData = await checkInRes.json();
      if (!checkInRes.ok) {
        throw new Error(checkInData.error || "Failed to check in tenant");
      }

      setActionSuccess(
        `Tenant ${assignedResidentName} successfully assigned to Room ${assigningRoom.roomNumber}. Bed occupancy updated.`
      );
      setAssigningRoom(null);
      setShowAssignConfirm(false);
      await fetchRooms();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(err.message || "Failed to check in tenant.");
      setShowAssignConfirm(false); // Return to form so user can correct input
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
      {/* 1. HEADER (Dashboard-Aligned Typography & Palette)             */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[#8E9F89]/20">
        <div className="border-l-4 border-[#B58A57] pl-3.5">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#1A2E20]">
            Rooms &amp; Bed Inventory
          </h1>
          <p className="text-xs sm:text-sm text-[#5A6C5E] mt-1 font-sans">
            Authoritative room inventory and live bed occupancy derived from active resident stays.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={fetchRooms}
            disabled={loading}
            className="p-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shadow-2xs"
            title="Refresh room data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-medium transition-all shadow-md hover:shadow-lg active:scale-95"
          >
            <Plus className="w-4 h-4 text-[#B58A57]" />
            <span>Add New Room</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK BANNERS */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center gap-2.5 shadow-2xs animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{actionSuccess}</span>
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
      {/* 2. SUMMARY KPI CARDS (Dashboard Aesthetic & Tabular Numerics)   */}
      {/* ============================================================== */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Total Rooms */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
            Total Rooms
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums">
              {stats.totalRooms}
            </span>
          </div>
          <span className="text-xs text-[#5A6C5E] mt-2 block font-light">
            Inventory count
          </span>
        </div>

        {/* Total Capacity */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
            Total Capacity
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums">
              {stats.totalCapacity}
            </span>
          </div>
          <span className="text-xs text-[#5A6C5E] mt-2 block font-light">
            Configured beds
          </span>
        </div>

        {/* Occupied Beds */}
        <div className="bg-white rounded-2xl border border-emerald-200 bg-emerald-50/20 p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
            Occupied Beds
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-emerald-950 font-serif tabular-nums">
              {stats.occupiedBeds}
            </span>
          </div>
          <span className="text-xs text-emerald-700/80 mt-2 block font-light">
            Active residents
          </span>
        </div>

        {/* Vacant Beds */}
        <div className="bg-white rounded-2xl border border-[#B58A57]/30 bg-[#FAF8F5] p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#654735]">
            Vacant Beds
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20] font-serif tabular-nums">
              {stats.availableBeds}
            </span>
          </div>
          <span className="text-xs text-[#654735] mt-2 block font-light">
            Ready for check-in
          </span>
        </div>

        {/* Occupancy Rate */}
        <div className="col-span-2 sm:col-span-1 bg-gradient-to-br from-[#1A2E20] to-[#263B2D] text-white rounded-2xl p-4 sm:p-5 shadow-2xs border border-[#8E9F89]/30 flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#C89F6B]">
            Occupancy Rate
          </span>
          <div className="mt-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white font-serif tabular-nums">
              {stats.occupancyRate}%
            </span>
          </div>
          <div className="w-full bg-white/20 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-[#B58A57] h-full rounded-full transition-all duration-500"
              style={{ width: `${stats.occupancyRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 3. SEARCH & FILTERS BAR                                        */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-3.5 sm:p-4 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#6E7F70] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by room number or resident name..."
            className="w-full pl-9 pr-4 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs sm:text-sm text-[#1A2E20] placeholder:text-[#6E7F70] focus:outline-hidden focus:border-[#1A2E20] focus:ring-1 focus:ring-[#1A2E20]"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Floor filter with Full Human-Readable Floor Labels */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Floor:</span>
            <select
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
            >
              <option value="ALL">All Floors</option>
              {floors.map((fl) => (
                <option key={fl} value={fl}>
                  {formatFloorLabel(fl)}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as any)}
              className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
            >
              <option value="ALL">All Rooms</option>
              <option value="VACANT">Has Vacant Beds</option>
              <option value="OCCUPIED">Occupied Rooms</option>
            </select>
          </div>

          <span className="text-xs text-[#6E7F70] pl-1 font-mono tabular-nums">
            {filteredRooms.length} room{filteredRooms.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 4. HORIZONTAL ROOM-ROW LISTING                                 */}
      {/* ============================================================== */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs">
          <RefreshCw className="w-6 h-6 text-[#B58A57] animate-spin mx-auto mb-2" />
          <p className="text-xs text-[#5A6C5E]">Loading room inventory from database...</p>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#8E9F89]/25 shadow-2xs space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center mx-auto text-[#1A2E20]">
            <BedDouble className="w-6 h-6 text-[#B58A57]" />
          </div>
          <h3 className="font-serif text-lg text-[#1A2E20] font-bold">No Rooms Found</h3>
          <p className="text-xs text-[#5A6C5E] max-w-md mx-auto">
            {rooms.length === 0
              ? "Your room inventory is empty. Click 'Add New Room' to provision your first PG accommodation."
              : "No rooms match your search query or filter selection."}
          </p>
          {rooms.length === 0 && (
            <button
              onClick={handleOpenAddModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1A2E20] text-white text-xs font-medium"
            >
              <Plus className="w-4 h-4 text-[#B58A57]" />
              <span>Create First Room</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredRooms.map((room) => {
            const isFull = room.availableBeds === 0;
            const isVacant = room.occupiedBeds === 0;

            const statusBadge = isFull
              ? { text: "Fully Occupied", bg: "bg-rose-50 text-rose-800 border-rose-200" }
              : isVacant
              ? { text: "Vacant (Available)", bg: "bg-emerald-50 text-emerald-800 border-emerald-200" }
              : {
                  text: `${room.availableBeds} Bed${room.availableBeds > 1 ? "s" : ""} Available`,
                  bg: "bg-amber-50 text-amber-800 border-amber-200",
                };

            return (
              <div
                key={room.id}
                className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs hover:shadow-md hover:border-[#5D7656]/40 transition-all"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 lg:gap-5 items-center">
                  {/* COLUMN 1: Room Identity & Complete Floor Label (lg:col-span-3) */}
                  <div className="lg:col-span-3 space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="font-serif text-2xl font-bold text-[#1A2E20] tracking-tight tabular-nums">
                        Room {room.roomNumber}
                      </h3>
                      {/* Full Human-Readable Floor Label (e.g. Ground Floor, Floor 1) */}
                      <span className="px-2.5 py-0.5 rounded-md bg-[#FAF8F5] text-[#5A6C5E] text-xs font-medium border border-[#8E9F89]/25 whitespace-nowrap">
                        {formatFloorLabel(room.floor)}
                      </span>
                    </div>

                    <p className="text-xs text-[#5A6C5E] font-medium">
                      {ROOM_TYPE_LABELS[room.type] || room.type}
                    </p>

                    <div>
                      <span
                        className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${statusBadge.bg} whitespace-nowrap`}
                      >
                        {statusBadge.text}
                      </span>
                    </div>
                  </div>

                  {/* COLUMN 2: Bed Capacity — Visual Grouping & Zero Awkward Wrapping (lg:col-span-3) */}
                  <div className="lg:col-span-3 space-y-2 bg-[#FAF8F5]/80 p-3 rounded-xl border border-[#8E9F89]/20">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
                        Bed Capacity
                      </span>
                      {/* Numerator and denominator strictly together on one line */}
                      <span className="whitespace-nowrap tabular-nums font-bold text-sm text-[#1A2E20]">
                        {room.occupiedBeds} / {room.capacity} beds
                      </span>
                    </div>

                    {/* Segmented meter visualizer */}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      {Array.from({ length: room.capacity }).map((_, idx) => {
                        const isOccupied = idx < room.occupiedBeds;
                        return (
                          <div
                            key={idx}
                            className={`h-2.5 flex-1 rounded-sm transition-all ${
                              isOccupied
                                ? "bg-[#1A2E20]"
                                : "bg-[#8E9F89]/25 border border-dashed border-[#8E9F89]/50"
                            }`}
                            title={
                              isOccupied
                                ? `Bed ${idx + 1}: Occupied`
                                : `Bed ${idx + 1}: Vacant`
                            }
                          />
                        );
                      })}
                    </div>

                    {/* Availability description beneath capacity value */}
                    <div className="pt-0.5">
                      {room.availableBeds === 0 ? (
                        <span className="whitespace-nowrap text-xs text-rose-700 font-semibold">
                          Fully occupied
                        </span>
                      ) : room.occupiedBeds === 0 ? (
                        <span className="whitespace-nowrap text-xs text-emerald-700 font-semibold">
                          {room.availableBeds} beds available (Vacant)
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-xs text-amber-700 font-semibold">
                          {room.availableBeds} {room.availableBeds === 1 ? "bed" : "beds"} available
                        </span>
                      )}
                    </div>
                  </div>

                  {/* COLUMN 3: Current Occupants & Prominent Add/Assign Tenant Action (lg:col-span-4) */}
                  <div className="lg:col-span-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
                        Current Occupants ({room.occupants?.length || 0})
                      </span>
                      {room.availableBeds > 0 && room.occupiedBeds > 0 && (
                        <span className="text-[10px] text-emerald-700 font-medium">
                          {room.availableBeds} bed available
                        </span>
                      )}
                    </div>

                    {room.occupants && room.occupants.length > 0 ? (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {room.occupants.map((occ) => (
                          <div
                            key={occ.stayId}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#8E9F89]/40 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-full bg-[#1A2E20] text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                                {occ.fullName.charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#1A2E20] truncate">
                                  {occ.fullName}
                                </p>
                                <p className="font-mono tabular-nums text-[11px] text-[#5A6C5E]">
                                  {occ.phone}
                                </p>
                              </div>
                            </div>

                            {/* Direct Resident Actions */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleOpenEditResident(occ, room)}
                                className="p-1.5 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-white border border-transparent hover:border-[#8E9F89]/30 transition-all"
                                title="Edit resident profile"
                              >
                                <UserCog className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleOpenCheckOutResident(occ, room)}
                                className="p-1.5 rounded-lg text-amber-700 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all"
                                title="Check out resident"
                              >
                                <LogOut className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Partially Occupied Room: Add Tenant button alongside occupants */}
                        {room.availableBeds > 0 && (
                          <button
                            onClick={() => handleOpenAddTenant(room)}
                            className="w-full mt-1.5 py-1.5 px-3 rounded-xl border border-dashed border-[#1A2E20]/30 hover:border-[#1A2E20] bg-white hover:bg-[#FAF8F5] text-xs font-semibold text-[#1A2E20] inline-flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                          >
                            <UserPlus className="w-3.5 h-3.5 text-[#B58A57]" />
                            <span>Assign Tenant ({room.availableBeds} bed left)</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      /* Completely Vacant Room: Prominent Add Tenant Action */
                      <div className="p-3 rounded-xl bg-[#FAF8F5]/80 border border-dashed border-[#8E9F89]/30 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-[#1A2E20]">No active occupants</p>
                          <p className="text-[11px] text-[#5A6C5E]">
                            {room.capacity} {room.capacity === 1 ? "bed" : "beds"} ready for check-in
                          </p>
                        </div>
                        <button
                          onClick={() => handleOpenAddTenant(room)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold transition-all shadow-xs hover:shadow-md active:scale-95 shrink-0"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-[#B58A57]" />
                          <span>Add Tenant</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* COLUMN 4: Base Monthly Rent & Room Actions (lg:col-span-2) */}
                  <div className="lg:col-span-2 flex flex-col justify-between items-end gap-2.5 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#8E9F89]/20">
                    <div className="text-right">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70] block">
                        Base Monthly Rent
                      </span>
                      <div className="font-serif text-lg font-bold text-[#1A2E20] tabular-nums">
                        ₹{room.baseRentMonthly.toLocaleString("en-IN")}{" "}
                        <span className="text-xs font-sans font-normal text-[#5A6C5E]">
                          / bed
                        </span>
                      </div>
                      <span className="text-[10px] text-[#8E9F89] block font-light">
                        Configured base rate
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenEditRoom(room)}
                        className="px-3 py-1.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-xs font-semibold text-[#1A2E20] inline-flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                        title="Edit room configuration"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#B58A57]" />
                        <span>Edit</span>
                      </button>

                      <button
                        onClick={() => handleOpenDeleteRoom(room)}
                        className="p-1.5 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 transition-colors shadow-2xs"
                        title={
                          room.occupiedBeds > 0
                            ? "Cannot delete: room is occupied"
                            : "Delete room"
                        }
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD TENANT DIRECTLY TO AVAILABLE BED                    */}
      {/* ============================================================== */}
      {assigningRoom && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-lg w-full p-6 shadow-2xl space-y-4 animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#1A2E20] text-[#B58A57] flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                    Assign Tenant &bull; Room {assigningRoom.roomNumber}
                  </h3>
                  <p className="text-[11px] text-[#5A6C5E]">
                    {formatFloorLabel(assigningRoom.floor)} &bull; {ROOM_TYPE_LABELS[assigningRoom.type]} &bull; {assigningRoom.availableBeds} bed{assigningRoom.availableBeds > 1 ? "s" : ""} vacant
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setAssigningRoom(null);
                  setShowAssignConfirm(false);
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

            {!showAssignConfirm ? (
              <form onSubmit={handleCommitAddTenant} className="space-y-4">
                {/* Registration Mode Tabs */}
                <div className="flex p-1 bg-[#FAF8F5] rounded-xl border border-[#8E9F89]/25 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => {
                      setAssignMode("NEW");
                      setActionError(null);
                    }}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      assignMode === "NEW"
                        ? "bg-[#1A2E20] text-white shadow-xs"
                        : "text-[#5A6C5E] hover:text-[#1A2E20]"
                    }`}
                  >
                    Register New Tenant
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssignMode("EXISTING");
                      setActionError(null);
                    }}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      assignMode === "EXISTING"
                        ? "bg-[#1A2E20] text-white shadow-xs"
                        : "text-[#5A6C5E] hover:text-[#1A2E20]"
                    }`}
                  >
                    Select Checked-Out Resident
                  </button>
                </div>

                {assignMode === "NEW" ? (
                  /* New Resident Profile Inputs */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                          Full Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Ramesh Kumar"
                          value={tenantFormData.fullName}
                          onChange={(e) =>
                            setTenantFormData({
                              ...tenantFormData,
                              fullName: e.target.value,
                            })
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
                          placeholder="e.g. 9812044101"
                          value={tenantFormData.phone}
                          onChange={(e) =>
                            setTenantFormData({
                              ...tenantFormData,
                              phone: e.target.value,
                            })
                          }
                          className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                          Email Address
                        </label>
                        <input
                          type="email"
                          placeholder="tenant@example.com"
                          value={tenantFormData.email}
                          onChange={(e) =>
                            setTenantFormData({
                              ...tenantFormData,
                              email: e.target.value,
                            })
                          }
                          className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                          Emergency Contact
                        </label>
                        <input
                          type="tel"
                          placeholder="Relative / Parent contact"
                          value={tenantFormData.emergencyContact}
                          onChange={(e) =>
                            setTenantFormData({
                              ...tenantFormData,
                              emergencyContact: e.target.value,
                            })
                          }
                          className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                        Notes / Resident Remarks
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Panasonic India employee, vegetarian"
                        value={tenantFormData.notes}
                        onChange={(e) =>
                          setTenantFormData({
                            ...tenantFormData,
                            notes: e.target.value,
                          })
                        }
                        className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                      />
                    </div>
                  </div>
                ) : (
                  /* Existing Resident Selector */
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                        Select Checked-Out Resident Profile *
                      </label>
                      {loadingResidentsList ? (
                        <div className="py-3 text-center text-xs text-[#5A6C5E]">
                          <RefreshCw className="w-4 h-4 text-[#B58A57] animate-spin inline-block mr-2" />
                          Loading checked-out residents...
                        </div>
                      ) : checkedOutResidents.length === 0 ? (
                        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                          No checked-out residents found. Please switch to the &ldquo;Register New Tenant&rdquo; tab.
                        </div>
                      ) : (
                        <select
                          required
                          value={selectedExistingResidentId}
                          onChange={(e) => setSelectedExistingResidentId(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                        >
                          <option value="">-- Choose a past resident to re-assign --</option>
                          {checkedOutResidents.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.fullName} &bull; {r.phone}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {/* Common Stay Terms */}
                <div className="pt-2 border-t border-[#8E9F89]/20 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                        Check-in Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={tenantFormData.checkInDate}
                        onChange={(e) =>
                          setTenantFormData({
                            ...tenantFormData,
                            checkInDate: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                        Monthly Rent (₹) *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        required
                        value={tenantFormData.monthlyRent}
                        onChange={(e) =>
                          setTenantFormData({
                            ...tenantFormData,
                            monthlyRent: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
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
                        value={tenantFormData.securityDeposit}
                        onChange={(e) =>
                          setTenantFormData({
                            ...tenantFormData,
                            securityDeposit: Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAssigningRoom(null)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-medium shadow-xs"
                  >
                    Review Check-In
                  </button>
                </div>
              </form>
            ) : (
              /* Confirmation Screen before Committing */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-2">
                  <p className="font-semibold text-[#1A2E20]">Confirm Tenant Check-In Details:</p>
                  <div className="grid grid-cols-2 gap-2 text-[#5A6C5E]">
                    <div>
                      <span>Tenant Name: </span>
                      <strong className="text-[#1A2E20]">
                        {assignMode === "NEW"
                          ? tenantFormData.fullName
                          : checkedOutResidents.find((r) => r.id === selectedExistingResidentId)?.fullName}
                      </strong>
                    </div>
                    <div>
                      <span>Phone: </span>
                      <strong className="text-[#1A2E20] font-mono tabular-nums">
                        {assignMode === "NEW"
                          ? tenantFormData.phone
                          : checkedOutResidents.find((r) => r.id === selectedExistingResidentId)?.phone}
                      </strong>
                    </div>
                    <div>
                      <span>Target Room: </span>
                      <strong className="text-[#1A2E20]">Room {assigningRoom.roomNumber}</strong>
                    </div>
                    <div>
                      <span>Floor: </span>
                      <strong className="text-[#1A2E20]">{formatFloorLabel(assigningRoom.floor)}</strong>
                    </div>
                    <div>
                      <span>Check-In Date: </span>
                      <span className="font-mono tabular-nums text-[#1A2E20] font-semibold">
                        {tenantFormData.checkInDate}
                      </span>
                    </div>
                    <div>
                      <span>Monthly Rent: </span>
                      <strong className="text-[#1A2E20] tabular-nums">
                        ₹{Number(tenantFormData.monthlyRent).toLocaleString("en-IN")} / mo
                      </strong>
                    </div>
                    <div className="col-span-2">
                      <span>Security Deposit: </span>
                      <strong className="text-[#1A2E20] tabular-nums">
                        ₹{Number(tenantFormData.securityDeposit || 0).toLocaleString("en-IN")}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-950 leading-relaxed">
                  <strong>Occupancy Activation:</strong> Confirming this check-in will immediately assign 1 bed in Room {assigningRoom.roomNumber}. The room&apos;s available beds will update from {assigningRoom.availableBeds} to {assigningRoom.availableBeds - 1}.
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowAssignConfirm(false)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Back to Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleCommitAddTenant}
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold disabled:opacity-50 shadow-md"
                  >
                    {submitting ? "Checking In..." : "Confirm & Check In Tenant"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: ADD NEW ROOM (Real-time duplicate validation)          */}
      {/* ============================================================== */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-5 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <BedDouble className="w-5 h-5 text-[#B58A57]" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Add Room to Inventory
                </h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
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

            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Room Number *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 101, 204, G-01"
                  value={addFormData.roomNumber}
                  onChange={(e) =>
                    setAddFormData({ ...addFormData, roomNumber: e.target.value })
                  }
                  className={`w-full px-3.5 py-2.5 bg-[#FAF8F5] border rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden ${
                    isAddRoomDuplicate
                      ? "border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                      : "border-[#8E9F89]/35 focus:border-[#1A2E20]"
                  }`}
                />
                {isAddRoomDuplicate && (
                  <p className="text-xs text-rose-600 mt-1 font-medium">
                    Room number already exists.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Floor (0 = Ground Floor) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    required
                    value={addFormData.floor}
                    onChange={(e) =>
                      setAddFormData({
                        ...addFormData,
                        floor: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums"
                  />
                  <span className="text-[10px] text-[#5A6C5E] mt-0.5 block">
                    {formatFloorLabel(addFormData.floor)}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Bed Capacity *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    required
                    value={addFormData.capacity}
                    onChange={(e) =>
                      setAddFormData({
                        ...addFormData,
                        capacity: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Sharing / Room Type *
                </label>
                <select
                  value={addFormData.type}
                  onChange={(e) =>
                    setAddFormData({
                      ...addFormData,
                      type: e.target.value as RoomType,
                    })
                  }
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                >
                  <option value="SINGLE">Single Occupancy</option>
                  <option value="DOUBLE_SHARING">Double Sharing</option>
                  <option value="TRIPLE_SHARING">Triple Sharing</option>
                  <option value="EXECUTIVE_SUITE">Executive Suite</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Base Monthly Rent (₹) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  required
                  value={addFormData.baseRentMonthly}
                  onChange={(e) =>
                    setAddFormData({
                      ...addFormData,
                      baseRentMonthly: Number(e.target.value),
                    })
                  }
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    isAddRoomDuplicate ||
                    !addFormData.roomNumber.trim()
                  }
                  className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Creating..." : "Save Room"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: EDIT ROOM (Full Editing, Duplicate & Capacity Guard) */}
      {/* ============================================================== */}
      {editingRoom && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-5 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div>
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold tabular-nums">
                  Edit Room {editingRoom.roomNumber}
                </h3>
                <p className="text-[11px] text-[#5A6C5E]">
                  Current occupied beds:{" "}
                  <strong className="text-[#1A2E20] tabular-nums">{editingRoom.occupiedBeds}</strong>
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingRoom(null);
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
              <form onSubmit={handleUpdateRoom} className="space-y-4">
                {/* Room Number Edit with inline duplicate validation */}
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Room Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={editFormData.roomNumber}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        roomNumber: e.target.value,
                      })
                    }
                    className={`w-full px-3.5 py-2.5 bg-[#FAF8F5] border rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden ${
                      isEditRoomDuplicate
                        ? "border-rose-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500"
                        : "border-[#8E9F89]/35 focus:border-[#1A2E20]"
                    }`}
                  />
                  {isEditRoomDuplicate && (
                    <p className="text-xs text-rose-600 mt-1 font-medium">
                      Room number already exists.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                      Floor
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={editFormData.floor}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          floor: Number(e.target.value),
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums"
                    />
                    <span className="text-[10px] text-[#5A6C5E] mt-0.5 block">
                      {formatFloorLabel(editFormData.floor)}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                      Bed Capacity (Min {editingRoom.occupiedBeds})
                    </label>
                    <input
                      type="number"
                      min={editingRoom.occupiedBeds}
                      max="10"
                      value={editFormData.capacity}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          capacity: Number(e.target.value),
                        })
                      }
                      className={`w-full px-3.5 py-2.5 bg-[#FAF8F5] border rounded-xl text-xs text-[#1A2E20] tabular-nums ${
                        isEditCapacityInvalid
                          ? "border-rose-500 focus:border-rose-500"
                          : "border-[#8E9F89]/35"
                      }`}
                    />
                    {isEditCapacityInvalid && (
                      <p className="text-[11px] text-rose-600 mt-1 font-medium">
                        Capacity cannot be lower than active occupants ({editingRoom.occupiedBeds}).
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Room Type
                  </label>
                  <select
                    value={editFormData.type}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        type: e.target.value as RoomType,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  >
                    <option value="SINGLE">Single Occupancy</option>
                    <option value="DOUBLE_SHARING">Double Sharing</option>
                    <option value="TRIPLE_SHARING">Triple Sharing</option>
                    <option value="EXECUTIVE_SUITE">Executive Suite</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Base Monthly Rent (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={editFormData.baseRentMonthly}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        baseRentMonthly: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] tabular-nums"
                  />
                  <p className="text-[11px] text-[#8E9F89] mt-1 font-light">
                    Note: Base rent edits apply to future check-ins and do not alter existing resident agreements or historical charges.
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setEditingRoom(null)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isEditRoomDuplicate ||
                      isEditCapacityInvalid ||
                      !editFormData.roomNumber.trim()
                    }
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Review Changes
                  </button>
                </div>
              </form>
            ) : (
              /* Confirmation step before updating room */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-2">
                  <p className="font-semibold text-[#1A2E20]">Confirm Configuration Changes:</p>
                  <div className="grid grid-cols-2 gap-2 text-[#5A6C5E]">
                    <div>
                      <span>Room Number: </span>
                      <strong className="text-[#1A2E20] tabular-nums">{editFormData.roomNumber}</strong>
                    </div>
                    <div>
                      <span>Floor: </span>
                      <strong className="text-[#1A2E20]">
                        {formatFloorLabel(editFormData.floor)}
                      </strong>
                    </div>
                    <div>
                      <span>Type: </span>
                      <strong className="text-[#1A2E20]">
                        {ROOM_TYPE_LABELS[editFormData.type]}
                      </strong>
                    </div>
                    <div>
                      <span>Capacity: </span>
                      <strong className="text-[#1A2E20] tabular-nums">
                        {editFormData.capacity} beds (Occupied: {editingRoom.occupiedBeds})
                      </strong>
                    </div>
                    <div className="col-span-2">
                      <span>Base Monthly Rent: </span>
                      <strong className="text-[#1A2E20] tabular-nums">
                        ₹{editFormData.baseRentMonthly.toLocaleString("en-IN")} / bed
                      </strong>
                    </div>
                  </div>
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
                    onClick={handleUpdateRoom}
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-medium disabled:opacity-50"
                  >
                    {submitting ? "Saving..." : "Confirm & Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: DELETE ROOM CONFIRMATION DIALOG                       */}
      {/* ============================================================== */}
      {deletingRoom && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold tabular-nums">
                  Delete Room {deletingRoom.roomNumber}
                </h3>
              </div>
              <button
                onClick={() => setDeletingRoom(null)}
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

            {deletingRoom.occupiedBeds > 0 ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
                  <p className="font-semibold mb-1">Cannot Delete Occupied Room</p>
                  <p>
                    Room {deletingRoom.roomNumber} currently has{" "}
                    <strong className="tabular-nums">{deletingRoom.occupiedBeds} active occupant(s)</strong>.
                    To maintain data integrity, you must check out all residents before this room can be removed.
                  </p>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => setDeletingRoom(null)}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] text-white text-xs font-medium"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[#5A6C5E] leading-relaxed">
                  Are you sure you want to permanently delete{" "}
                  <strong className="text-[#1A2E20] tabular-nums">Room {deletingRoom.roomNumber}</strong>{" "}
                  ({formatFloorLabel(deletingRoom.floor)},{" "}
                  <span className="tabular-nums">{deletingRoom.capacity}</span> beds) from inventory?
                </p>

                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 text-[11px] text-[#5A6C5E]">
                  <strong>Audit &amp; Financial Protection:</strong> Rooms with past resident stays or historical transactions cannot be deleted to preserve financial audit history.
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    onClick={() => setDeletingRoom(null)}
                    className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteRoom}
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium disabled:opacity-50"
                  >
                    {submitting ? "Deleting..." : "Confirm Delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 4: EDIT RESIDENT DETAILS                                 */}
      {/* ============================================================== */}
      {editingResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <UserCog className="w-5 h-5 text-[#B58A57]" />
                <div>
                  <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                    Edit Resident Profile
                  </h3>
                  <p className="text-[11px] text-[#5A6C5E]">
                    Currently residing in Room {editingResident.room.roomNumber}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEditingResident(null)}
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

            {loadingResidentDetail ? (
              <div className="py-8 text-center text-xs text-[#5A6C5E]">
                <RefreshCw className="w-5 h-5 text-[#B58A57] animate-spin mx-auto mb-2" />
                Loading resident details...
              </div>
            ) : (
              <form onSubmit={handleUpdateResident} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={residentFormData.fullName}
                    onChange={(e) =>
                      setResidentFormData({
                        ...residentFormData,
                        fullName: e.target.value,
                      })
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
                    value={residentFormData.phone}
                    onChange={(e) =>
                      setResidentFormData({
                        ...residentFormData,
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
                    value={residentFormData.email}
                    onChange={(e) =>
                      setResidentFormData({
                        ...residentFormData,
                        email: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Emergency Contact
                  </label>
                  <input
                    type="tel"
                    value={residentFormData.emergencyContact}
                    onChange={(e) =>
                      setResidentFormData({
                        ...residentFormData,
                        emergencyContact: e.target.value,
                      })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                    Notes / Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={residentFormData.notes}
                    onChange={(e) =>
                      setResidentFormData({
                        ...residentFormData,
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
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-medium disabled:opacity-50"
                  >
                    {submitting ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 5: RESIDENT CHECK-OUT CONFIRMATION DIALOG               */}
      {/* ============================================================== */}
      {checkingOutResident && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div className="flex items-center gap-2">
                <LogOut className="w-5 h-5 text-amber-600" />
                <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                  Check Out Resident
                </h3>
              </div>
              <button
                onClick={() => setCheckingOutResident(null)}
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

            <form onSubmit={handleCheckOutResident} className="space-y-3.5">
              <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#5A6C5E]">Resident:</span>
                  <strong className="text-[#1A2E20]">
                    {checkingOutResident.occupant.fullName}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5A6C5E]">Room:</span>
                  <strong className="text-[#1A2E20] tabular-nums">
                    Room {checkingOutResident.room.roomNumber} ({formatFloorLabel(checkingOutResident.room.floor)})
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5A6C5E]">Check-in Date:</span>
                  <span className="font-mono tabular-nums text-[#1A2E20]">
                    {checkingOutResident.occupant.checkInDate}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Official Check-Out Date *
                </label>
                <input
                  type="date"
                  required
                  value={checkOutDate}
                  onChange={(e) => setCheckOutDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono tabular-nums font-medium focus:outline-hidden focus:border-[#1A2E20]"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed">
                <strong>Capacity Release:</strong> Checking out completes this stay and immediately releases 1 bed in Room {checkingOutResident.room.roomNumber} for new check-ins. All historical billing and payment records are preserved.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setCheckingOutResident(null)}
                  className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs text-[#1A2E20] hover:bg-[#FAF8F5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-medium disabled:opacity-50"
                >
                  {submitting ? "Checking out..." : "Confirm Check-Out"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
