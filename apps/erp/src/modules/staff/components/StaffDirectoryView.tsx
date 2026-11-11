"use client";

import { friendlyError } from "@/lib/friendlyError";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useMemo } from "react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { ActionMenu } from "@/components/ui/ActionMenu";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { LoadError, NoMatches, StateMessage } from "@/components/ui/states";
import { PageHeader, StatStrip, SearchField, Segmented, Badge } from "@/components/ui/kit";
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
  AlertCircle,
  Send,
  Trash2,
} from "lucide-react";

export function StaffDirectoryView({ currentUser }: { currentUser: AuthenticatedUser }) {
  const [actionError, setActionError] = useState<string | null>(null);
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

  // Search is debounced into the cache key; one request per distinct filter set.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handler);
  }, [search]);

  const staffParams = new URLSearchParams();
  if (selectedRole !== "ALL") staffParams.append("role", selectedRole);
  if (statusFilter !== "ALL") staffParams.append("status", statusFilter);
  if (debouncedSearch) staffParams.append("search", debouncedSearch);
  const staffKey = `/api/staff?${staffParams.toString()}`;

  // Staff accounts change only through this screen, so cached results are reused across visits
  // for 5 minutes and every staff mutation invalidates them immediately.
  const staffQuery = useErpQuery<{ staff: StaffUser[]; stats: StaffStats | null }>(
    staffKey,
    async () => {
      const res = await fetch(staffKey);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load staff accounts.");
      return { staff: data.staff || [], stats: data.stats || null };
    },
    { ttl: 300000, tags: ["staff"] }
  );
  const staffList = staffQuery.data?.staff ?? [];
  const stats: StaffStats = staffQuery.data?.stats ?? {
    totalStaff: 0,
    activeStaff: 0,
    deactivatedStaff: 0,
    superAdmins: 0,
  };
  const loading = staffQuery.isLoading && !staffQuery.data;
  const error = actionError ?? staffQuery.error?.message ?? null;
  const setError = setActionError;
  const fetchStaff = () => invalidateErpCache(["staff"]);

  // Owner, then Manager, then Delivery; active before deactivated; then by name.
  const ROLE_ORDER: Record<string, number> = { SUPER_ADMIN: 0, OPERATIONS_MANAGER: 1, DELIVERY_PERSON: 2 };
  const sortedStaff = useMemo(
    () =>
      [...staffList].sort(
        (a, b) =>
          (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
          Number(Boolean(b.isActive)) - Number(Boolean(a.isActive)) ||
          a.fullName.localeCompare(b.fullName)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staffList]
  );

  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/staff/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "The account could not be deleted.");
      setBannerNotice(`${deleteTarget.fullName}'s account was deleted.`);
      setTimeout(() => setBannerNotice(null), 6000);
      setDeleteTarget(null);
      fetchStaff();
    } catch (err: any) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

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
      setError(friendlyError(err.message));
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

      <PageHeader
        title="Staff"
        actions={
          isSuperAdmin ? (
            <button type="button" onClick={() => setIsCreateOpen(true)} className="rn-btn rn-btn-primary">
              <UserPlus /> Add staff
            </button>
          ) : undefined
        }
      />

      <StatStrip
        items={[
          { label: "Active", value: stats.activeStaff, tone: "good" },
          { label: "Deactivated", value: stats.deactivatedStaff, tone: stats.deactivatedStaff > 0 ? "bad" : "default" },
          { label: "Owners", value: stats.superAdmins },
          { label: "All accounts", value: stats.totalStaff },
        ]}
      />

      <div className="rn-card rn-mflat">
      <div className="p-4 sm:p-5 border-b border-[var(--rn-line)] flex flex-wrap items-center gap-2.5">
        <SearchField value={search} onChange={setSearch} placeholder="Search name, username or email" className="flex-1 basis-[240px]" />
        <div className="flex flex-wrap items-center gap-2">
          <AppSelect value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} aria-label="Role" className="rn-input">
            <option value="ALL">All roles</option>
            {Object.keys(ROLE_LABELS).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r as StaffRole]}
              </option>
            ))}
          </AppSelect>
          <Segmented
            size="sm"
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "ALL", label: "All" },
              { value: "ACTIVE", label: "Active" },
              { value: "DEACTIVATED", label: "Deactivated" },
            ]}
          />
        </div>
      </div>

      {/* Staff list: Owner, Manager, Delivery; active before deactivated; then by name */}
      <div>
        {loading ? (
          <BikeLoader label="Loading staff…" className="py-16" />
        ) : staffQuery.error && !staffQuery.data ? (
          <LoadError message={staffQuery.error.message} onRetry={() => staffQuery.refetch()} title="Staff could not be loaded" />
        ) : sortedStaff.length === 0 ? (
          search || selectedRole !== "ALL" || statusFilter !== "ALL" ? (
            <NoMatches title="No staff match these filters" onClear={() => { setSearch(""); setSelectedRole("ALL"); setStatusFilter("ALL"); }} />
          ) : (
            <StateMessage title="No staff accounts yet" action={isSuperAdmin ? <button type="button" className="rn-btn rn-btn-primary" onClick={() => setIsCreateOpen(true)}><UserPlus /> Add staff</button> : undefined} />
          )
        ) : (
          <table className="rn-table rn-mcards">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role</th>
                <th>Status</th>
                <th>Email</th>
                <th>Last sign-in</th>
                <th className="text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sortedStaff.map((member) => (
                <tr key={member.id}>
                  <td data-m="title">
                    <div className="flex items-center gap-3">
                      <span className="grid place-items-center w-8 h-8 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)] text-[12px] font-semibold shrink-0" aria-hidden>
                        {member.fullName.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--rn-ink)]">{member.fullName}</div>
                        <div className="rn-t-meta">@{member.username}</div>
                      </div>
                    </div>
                  </td>
                  <td data-m="kv"><Badge>{ROLE_LABELS[member.role] || member.role}</Badge></td>
                  <td data-m="badge">{member.isActive ? <Badge tone="good">Active</Badge> : <Badge>Deactivated</Badge>}</td>
                  <td data-m="kv" className="break-all">{member.email}</td>
                  <td data-m="kv" className="rn-t-meta tabular-nums">
                    {member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "Never"}
                  </td>
                  <td data-m="actions" className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => { setSelectedStaff(member); setIsHistoryOpen(true); }}
                        title="Login history"
                        aria-label={`Login history for ${member.fullName}`}
                        data-m-wide
                        className="rn-btn rn-btn-sm rn-btn-icon"
                      >
                        <History /><span className="lg:hidden">Sign-in history</span>
                      </button>
                      {isSuperAdmin && (
                        <ActionMenu
                          label={`Actions for ${member.fullName}`}
                          items={[
                            { label: "Edit profile", icon: Edit2, onSelect: () => { setSelectedStaff(member); setIsEditOpen(true); } },
                            { label: "Change role", icon: Shield, onSelect: () => { setSelectedStaff(member); setIsRoleOpen(true); } },
                            {
                              label: "Send password reset link",
                              icon: Send,
                              disabled: !member.isActive || isDispatchingRecovery === member.id,
                              hint: !member.isActive ? "Reactivate the account first." : undefined,
                              onSelect: () => handleSendRecovery(member),
                            },
                            { label: "Set a new password", icon: KeyRound, onSelect: () => { setSelectedStaff(member); setIsDirectResetOpen(true); } },
                            {
                              label: member.isActive ? "Deactivate" : "Reactivate",
                              icon: Power,
                              tone: member.isActive ? "danger" : "default",
                              onSelect: () => { setSelectedStaff(member); setIsDeactivateOpen(true); },
                            },
                            {
                              label: "Delete account",
                              icon: Trash2,
                              tone: "danger",
                              disabled: member.role === "SUPER_ADMIN" || member.id === currentUser.id,
                              hint: member.role === "SUPER_ADMIN" ? "Owner accounts cannot be deleted." : member.id === currentUser.id ? "You cannot delete your own account." : undefined,
                              onSelect: () => { setDeleteError(null); setDeleteTarget(member); },
                            },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleDelete}
        busy={deleting}
        danger
        title={`Delete ${deleteTarget?.fullName ?? "this account"}?`}
        confirmLabel="Delete account"
        error={deleteError}
      />

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
