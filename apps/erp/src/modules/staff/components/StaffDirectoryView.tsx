"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  StaffUser,
  StaffRole,
  StaffStats,
  AuthenticatedUser,
  ROLE_LABELS,
  ROLE_BADGE_STYLES,
} from "@/types";
import {
  CreateStaffModal,
  EditStaffModal,
  ChangeRoleModal,
  DeactivateStaffModal,
  DirectResetModal,
  StaffHistoryModal,
} from "./StaffModals";
import {
  Users,
  UserPlus,
  Shield,
  ShieldAlert,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  MoreVertical,
  History,
  Mail,
  KeyRound,
  Edit2,
  Power,
  Loader2,
  AlertCircle,
  Send,
} from "lucide-react";

export function StaffDirectoryView({ currentUser }: { currentUser: AuthenticatedUser }) {
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [stats, setStats] = useState<StaffStats>({
    totalStaff: 0,
    activeStaff: 0,
    deactivatedStaff: 0,
    superAdmins: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  // Filter States
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "DEACTIVATED">("ALL");

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffUser | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isDirectResetOpen, setIsDirectResetOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [actionMenuStaffId, setActionMenuStaffId] = useState<string | null>(null);
  const [isDispatchingRecovery, setIsDispatchingRecovery] = useState<string | null>(null);

  const isSuperAdmin = currentUser.role === "SUPER_ADMIN";

  const fetchStaff = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedRole !== "ALL") params.append("role", selectedRole);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (search.trim()) params.append("search", search.trim());

      const res = await fetch(`/api/staff?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load staff accounts.");

      setStaffList(data.staff || []);
      if (data.stats) setStats(data.stats);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, [selectedRole, statusFilter]);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchStaff();
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const handleSendRecovery = async (staff: StaffUser) => {
    setIsDispatchingRecovery(staff.id);
    setActionMenuStaffId(null);
    try {
      const res = await fetch(`/api/staff/${staff.id}/recovery`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send recovery link.");
      setBannerNotice(data.message || `Password recovery link dispatched to ${staff.email}.`);
      setTimeout(() => setBannerNotice(null), 6000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsDispatchingRecovery(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      {bannerNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{bannerNotice}</span>
          </div>
          <button onClick={() => setBannerNotice(null)} className="text-emerald-700 hover:text-emerald-900">
            &times;
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900">
            &times;
          </button>
        </div>
      )}

      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E6E0D2]">
        <div>
          <div className="flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-[#1A2E20]" />
            <h1 className="font-serif text-2xl font-bold text-[#1A2E20]">
              Staff Administration &amp; Access Governance
            </h1>
          </div>
          <p className="text-xs text-[#445448] mt-1">
            Authoritative directory of internal personnel, RBAC role assignments, security sessions, and account recovery.
          </p>
        </div>

        {isSuperAdmin && (
          <button
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-bold uppercase tracking-wider transition-all shadow-sm shadow-[#1A2E20]/20"
          >
            <UserPlus className="w-4 h-4 text-[#B58A57]" />
            <span>Add Staff Account</span>
          </button>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-[#D5CEBF] shadow-xs">
          <div className="text-[11px] font-bold text-[#654735] uppercase tracking-wider">Total Staff</div>
          <div className="text-2xl font-serif font-bold text-[#1A2E20] mt-1">{stats.totalStaff}</div>
          <div className="text-[11px] text-[#445448] mt-0.5">Provisioned accounts in database</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#D5CEBF] shadow-xs">
          <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Active Staff</div>
          <div className="text-2xl font-serif font-bold text-emerald-800 mt-1">{stats.activeStaff}</div>
          <div className="text-[11px] text-[#445448] mt-0.5">Authorized for active sessions</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#D5CEBF] shadow-xs">
          <div className="text-[11px] font-bold text-red-700 uppercase tracking-wider">Deactivated</div>
          <div className="text-2xl font-serif font-bold text-red-800 mt-1">{stats.deactivatedStaff}</div>
          <div className="text-[11px] text-[#445448] mt-0.5">Access and sessions terminated</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-[#D5CEBF] shadow-xs">
          <div className="text-[11px] font-bold text-[#B58A57] uppercase tracking-wider">Super Admins</div>
          <div className="text-2xl font-serif font-bold text-[#1A2E20] mt-1">{stats.superAdmins}</div>
          <div className="text-[11px] text-[#445448] mt-0.5">Protected owner accounts</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-[#D5CEBF] shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-[#8E9F89] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username, or email..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-[#D5CEBF] focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
          />
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-[#D5CEBF] bg-white focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30 font-medium text-[#1A2E20]"
          >
            <option value="ALL">All Roles</option>
            {Object.keys(ROLE_LABELS).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r as StaffRole]}
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-xl border border-[#D5CEBF] p-0.5 bg-gray-50 text-xs font-semibold">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === "ALL" ? "bg-white shadow-xs text-[#1A2E20]" : "text-[#445448] hover:text-[#1A2E20]"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter("ACTIVE")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === "ACTIVE" ? "bg-white shadow-xs text-emerald-800" : "text-[#445448] hover:text-[#1A2E20]"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter("DEACTIVATED")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === "DEACTIVATED" ? "bg-white shadow-xs text-red-800" : "text-[#445448] hover:text-[#1A2E20]"
              }`}
            >
              Deactivated
            </button>
          </div>
        </div>
      </div>

      {/* Staff Table */}
      <div className="bg-white rounded-2xl border border-[#D5CEBF] shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-xs text-[#445448]">
            <Loader2 className="w-8 h-8 animate-spin text-[#1A2E20] mb-2" />
            <span>Loading staff directory...</span>
          </div>
        ) : staffList.length === 0 ? (
          <div className="py-16 text-center text-xs text-[#8E9F89]">
            No staff accounts found matching your filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#E6E0D2] bg-[#FAF9F6] text-[11px] font-bold text-[#654735] uppercase tracking-wider">
                  <th className="py-3.5 px-4">Staff Member</th>
                  <th className="py-3.5 px-4">Assigned Role</th>
                  <th className="py-3.5 px-4">Account Status</th>
                  <th className="py-3.5 px-4">Email Address</th>
                  <th className="py-3.5 px-4">Last Login</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E0D2] text-xs">
                {staffList.map((member) => {
                  const badgeStyle = ROLE_BADGE_STYLES[member.role] || {
                    bg: "bg-gray-100",
                    text: "text-gray-800",
                    border: "border-gray-200",
                  };

                  return (
                    <tr key={member.id} className="hover:bg-[#FAF9F6] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#1A2E20]/10 border border-[#1A2E20]/20 flex items-center justify-center font-bold text-[#1A2E20] uppercase text-xs">
                            {member.fullName.charAt(0)}
                          </div>
                          <div>
                            <div className="font-bold text-[#1A2E20]">{member.fullName}</div>
                            <div className="text-[11px] text-[#654735] font-mono">@{member.username}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                        >
                          {ROLE_LABELS[member.role] || member.role}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        {member.isActive ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-800 border border-red-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600" />
                            Deactivated
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-[#445448] font-medium">{member.email}</td>

                      <td className="py-3.5 px-4 text-[#8E9F89]">
                        {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString() : "Never logged in"}
                      </td>

                      <td className="py-3.5 px-4 text-right relative">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => {
                              setSelectedStaff(member);
                              setIsHistoryOpen(true);
                            }}
                            title="View Audit Trail"
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-[#445448] transition-colors"
                          >
                            <History className="w-4 h-4" />
                          </button>

                          {isSuperAdmin && (
                            <div className="relative">
                              <button
                                onClick={() =>
                                  setActionMenuStaffId(actionMenuStaffId === member.id ? null : member.id)
                                }
                                className="p-1.5 rounded-lg hover:bg-gray-100 text-[#1A2E20] transition-colors"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {actionMenuStaffId === member.id && (
                                <div className="absolute right-0 top-8 z-30 w-48 bg-white rounded-xl shadow-xl border border-[#D5CEBF] py-1.5 text-left text-xs animate-fadeIn">
                                  <button
                                    onClick={() => {
                                      setSelectedStaff(member);
                                      setIsEditOpen(true);
                                      setActionMenuStaffId(null);
                                    }}
                                    className="w-full px-3.5 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-[#1A2E20]"
                                  >
                                    <Edit2 className="w-3.5 h-3.5 text-gray-500" />
                                    <span>Edit Profile</span>
                                  </button>

                                  <button
                                    onClick={() => {
                                      setSelectedStaff(member);
                                      setIsRoleOpen(true);
                                      setActionMenuStaffId(null);
                                    }}
                                    className="w-full px-3.5 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-[#1A2E20]"
                                  >
                                    <Shield className="w-3.5 h-3.5 text-[#B58A57]" />
                                    <span>Change Role</span>
                                  </button>

                                  <button
                                    onClick={() => handleSendRecovery(member)}
                                    disabled={!member.isActive || isDispatchingRecovery === member.id}
                                    className="w-full px-3.5 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-[#1A2E20] disabled:opacity-50"
                                  >
                                    <Send className="w-3.5 h-3.5 text-blue-600" />
                                    <span>Send Recovery Link</span>
                                  </button>

                                  <button
                                    onClick={() => {
                                      setSelectedStaff(member);
                                      setIsDirectResetOpen(true);
                                      setActionMenuStaffId(null);
                                    }}
                                    className="w-full px-3.5 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-[#1A2E20]"
                                  >
                                    <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                                    <span>Emergency Direct Reset</span>
                                  </button>

                                  <div className="my-1 border-t border-[#E6E0D2]" />

                                  <button
                                    onClick={() => {
                                      setSelectedStaff(member);
                                      setIsDeactivateOpen(true);
                                      setActionMenuStaffId(null);
                                    }}
                                    className={`w-full px-3.5 py-2 text-left hover:bg-gray-50 flex items-center gap-2 ${
                                      member.isActive ? "text-red-700" : "text-emerald-700"
                                    }`}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                    <span>{member.isActive ? "Deactivate Account" : "Reactivate Account"}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateStaffModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => {
          fetchStaff();
          setBannerNotice("Staff account created successfully.");
          setTimeout(() => setBannerNotice(null), 5000);
        }}
        currentUser={currentUser}
      />

      <EditStaffModal
        staff={selectedStaff}
        isOpen={isEditOpen}
        onClose={() => {
          setIsEditOpen(false);
          setSelectedStaff(null);
        }}
        onUpdated={() => {
          fetchStaff();
          setBannerNotice("Staff profile updated successfully.");
          setTimeout(() => setBannerNotice(null), 5000);
        }}
      />

      <ChangeRoleModal
        staff={selectedStaff}
        isOpen={isRoleOpen}
        onClose={() => {
          setIsRoleOpen(false);
          setSelectedStaff(null);
        }}
        onRoleChanged={() => {
          fetchStaff();
          setBannerNotice("Staff role updated successfully.");
          setTimeout(() => setBannerNotice(null), 5000);
        }}
        currentUser={currentUser}
      />

      <DeactivateStaffModal
        staff={selectedStaff}
        isOpen={isDeactivateOpen}
        onClose={() => {
          setIsDeactivateOpen(false);
          setSelectedStaff(null);
        }}
        onStatusChanged={() => {
          fetchStaff();
          setBannerNotice("Staff account status updated successfully.");
          setTimeout(() => setBannerNotice(null), 5000);
        }}
      />

      <DirectResetModal
        staff={selectedStaff}
        isOpen={isDirectResetOpen}
        onClose={() => {
          setIsDirectResetOpen(false);
          setSelectedStaff(null);
        }}
        onReset={() => {
          fetchStaff();
          setBannerNotice("Staff password reset successfully and active sessions invalidated.");
          setTimeout(() => setBannerNotice(null), 5000);
        }}
      />

      <StaffHistoryModal
        staff={selectedStaff}
        isOpen={isHistoryOpen}
        onClose={() => {
          setIsHistoryOpen(false);
          setSelectedStaff(null);
        }}
      />
    </div>
  );
}
