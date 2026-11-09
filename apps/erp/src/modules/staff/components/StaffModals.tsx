"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState } from "react";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import {
  StaffUser,
  StaffRole,
  AuthenticatedUser,
  ROLE_LABELS,
  ROLE_BADGE_STYLES,
} from "@/types";
import {
  X,
  User,
  Mail,
  Lock,
  Shield,
  ShieldAlert,
  AlertTriangle,
  History,
  CheckCircle2,
  KeyRound,
  Send,
} from "lucide-react";

const CANONICAL_ROLES: StaffRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_MANAGER",
  "DELIVERY_PERSON",
];

// -----------------------------------------------------------------------------
// 1. Create Staff Account Modal
// -----------------------------------------------------------------------------
export function CreateStaffModal({
  isOpen,
  onClose,
  onCreated,
  currentUser,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  currentUser: AuthenticatedUser;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("OPERATIONS_MANAGER");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, username, email, role, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create staff account.");
      }
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden animate-fadeIn">
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <User className="w-5 h-5 text-[#B58A57]" />
            <h3 className="font-serif font-bold text-lg">Provision Staff Account</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Rajesh Sharma"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
                Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="rajesh_s"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
                Role
              </label>
              <AppSelect
                value={role}
                onChange={(e) => setRole(e.target.value as StaffRole)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
              >
                {CANONICAL_ROLES.map((r) => (
                  <option key={r} value={r} disabled={r === "SUPER_ADMIN" && currentUser.role !== "SUPER_ADMIN"}>
                    {ROLE_LABELS[r]} {r === "SUPER_ADMIN" && currentUser.role !== "SUPER_ADMIN" ? "(Admin Only)" : ""}
                  </option>
                ))}
              </AppSelect>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Authorized Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rajesh@ravinarayan.in"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Initial Password (Min 12 Characters)
            </label>
            <input
              type="password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30 font-mono"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E6E0D2]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-[#445448] hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold text-white bg-[#1A2E20] hover:bg-[#263B2D] rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              {loading ? <BikeLoader inline tone="light" label="Working" /> : "Create Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 2. Edit Profile Modal
// -----------------------------------------------------------------------------
export function EditStaffModal({
  staff,
  isOpen,
  onClose,
  onUpdated,
}: {
  staff: StaffUser | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [fullName, setFullName] = useState(staff?.fullName || "");
  const [email, setEmail] = useState(staff?.email || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (staff) {
      setFullName(staff.fullName);
      setEmail(staff.email);
    }
  }, [staff]);

  if (!isOpen || !staff) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${staff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update profile.");
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden">
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between">
          <h3 className="font-serif font-bold text-lg">Edit Profile: {staff.username}</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E6E0D2]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-[#445448] hover:bg-gray-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold text-white bg-[#1A2E20] hover:bg-[#263B2D] rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              {loading ? <BikeLoader inline tone="light" label="Working" /> : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 3. Change Role Modal
// -----------------------------------------------------------------------------
export function ChangeRoleModal({
  staff,
  isOpen,
  onClose,
  onRoleChanged,
  currentUser,
}: {
  staff: StaffUser | null;
  isOpen: boolean;
  onClose: () => void;
  onRoleChanged: () => void;
  currentUser: AuthenticatedUser;
}) {
  const [selectedRole, setSelectedRole] = useState<StaffRole>(staff?.role || "OPERATIONS_MANAGER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (staff) setSelectedRole(staff.role);
  }, [staff]);

  if (!isOpen || !staff) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedRole === staff.role) {
      onClose();
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${staff.id}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newRole: selectedRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update role.");
      onRoleChanged();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden">
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#B58A57]" />
            <h3 className="font-serif font-bold text-lg">Change Role</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <p className="text-xs text-[#445448] mb-3">
              Modifying role for <strong>{staff.fullName}</strong> (<code className="text-xs">{staff.username}</code>).
              Role permissions will update immediately on their next request.
            </p>

            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1.5">
              Select New Role
            </label>
            <div className="space-y-2">
              {CANONICAL_ROLES.map((r) => {
                const isCurrent = staff.role === r;
                const isSuperAdminOption = r === "SUPER_ADMIN";
                const isDisabled = isSuperAdminOption && currentUser.role !== "SUPER_ADMIN";

                return (
                  <label
                    key={r}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedRole === r
                        ? "border-[#1A2E20] bg-[#1A2E20]/5 ring-1 ring-[#1A2E20]"
                        : "border-[#D5CEBF] hover:bg-gray-50"
                    } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="staffRole"
                        value={r}
                        checked={selectedRole === r}
                        disabled={isDisabled}
                        onChange={() => setSelectedRole(r)}
                        className="text-[#1A2E20] focus:ring-[#1A2E20]"
                      />
                      <div>
                        <div className="text-xs font-bold text-[#1A2E20]">{ROLE_LABELS[r]}</div>
                        <div className="text-[10px] text-[#654735]">{r}</div>
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1A2E20]/10 text-[#1A2E20] font-bold">
                        Current
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E6E0D2]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-[#445448] hover:bg-gray-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || selectedRole === staff.role}
              className="px-5 py-2 text-xs font-bold text-white bg-[#1A2E20] hover:bg-[#263B2D] rounded-xl transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <BikeLoader inline tone="light" label="Working" /> : "Update Role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 4. Activate / Deactivate Modal
// -----------------------------------------------------------------------------
export function DeactivateStaffModal({
  staff,
  isOpen,
  onClose,
  onStatusChanged,
}: {
  staff: StaffUser | null;
  isOpen: boolean;
  onClose: () => void;
  onStatusChanged: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !staff) return null;

  const isDeactivating = staff.isActive;

  const handleToggle = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${staff.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !staff.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change account status.");
      onStatusChanged();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden">
        <div className={`px-6 py-4 text-white flex items-center justify-between ${isDeactivating ? "bg-[#842213]" : "bg-[#1A2E20]"}`}>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-white" />
            <h3 className="font-serif font-bold text-lg">
              {isDeactivating ? "Deactivate Staff Account" : "Activate Staff Account"}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div className="text-xs text-[#445448] space-y-2">
            <p>
              Are you sure you want to {isDeactivating ? "deactivate" : "reactivate"} the account for{" "}
              <strong>{staff.fullName}</strong> (<code className="text-xs">{staff.username}</code>)?
            </p>
            {isDeactivating ? (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] leading-relaxed">
                <strong>Security Impact:</strong> Deactivating this account will immediately revoke all active sessions across all devices. The staff member will be logged out on their next request and blocked from signing in. All historical transactions and records authored by this staff member will remain intact.
              </div>
            ) : (
              <p className="text-[11px] text-gray-500">
                Reactivating this account will permit the staff member to sign in again using their existing credentials.
              </p>
            )}
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E6E0D2]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-[#445448] hover:bg-gray-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleToggle}
              disabled={loading}
              className={`px-5 py-2 text-xs font-bold text-white rounded-xl transition-all shadow-sm flex items-center gap-2 ${
                isDeactivating
                  ? "bg-[#842213] hover:bg-[#681B0F]"
                  : "bg-[#1A2E20] hover:bg-[#263B2D]"
              }`}
            >
              {loading ? (
                <BikeLoader inline tone="light" label="Working" />
              ) : isDeactivating ? (
                "Deactivate & Revoke Sessions"
              ) : (
                "Reactivate Account"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 5. Emergency Direct Reset Modal (Super Admin Only)
// -----------------------------------------------------------------------------
export function DirectResetModal({
  staff,
  isOpen,
  onClose,
  onReset,
}: {
  staff: StaffUser | null;
  isOpen: boolean;
  onClose: () => void;
  onReset: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !staff) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 12) {
      setError("Password must be at least 12 characters long.");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/${staff.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset password.");
      onReset();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden">
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[#B58A57]" />
            <h3 className="font-serif font-bold text-lg">Direct Password Reset</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-xs text-[#445448]">
            Setting a new security password directly for <strong>{staff.fullName}</strong>.
            This emergency action will invalidate all current active sessions for this account.
          </p>

          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              New Password (Min 12 Characters)
            </label>
            <input
              type="password"
              required
              minLength={12}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#D5CEBF] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/30"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E6E0D2]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-[#445448] hover:bg-gray-100 rounded-xl"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold text-white bg-[#1A2E20] hover:bg-[#263B2D] rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              {loading ? <BikeLoader inline tone="light" label="Working" /> : "Reset & Invalidate Sessions"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 6. Staff Audit History Modal
// -----------------------------------------------------------------------------
export function StaffHistoryModal({
  staff,
  isOpen,
  onClose,
}: {
  staff: StaffUser | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen && staff) {
      setLoading(true);
      setError(null);
      fetch(`/api/staff/${staff.id}/history`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setHistory(data.history || []);
          } else {
            setError(data.error || "Failed to load history.");
          }
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [isOpen, staff]);

  if (!isOpen || !staff) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden flex flex-col max-h-[85dvh]">
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-[#B58A57]" />
            <h3 className="font-serif font-bold text-lg">Audit History: {staff.fullName}</h3>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          {loading ? (
            <BikeLoader tone="forest" label="Loading activity…" className="py-12" />
          ) : error ? (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#8E9F89]">
              No security or governance audit events recorded for this account.
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((ev) => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-xl border border-[#E6E0D2] bg-[#FAF9F6] text-xs flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-bold text-[#1A2E20] bg-white px-2 py-0.5 rounded-md border border-[#D5CEBF]">
                      {ev.action}
                    </span>
                    <span className="text-[#8E9F89]">{new Date(ev.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-[#445448] flex items-center gap-2">
                    <span>Actor: <strong className="text-[#1A2E20]">{ev.actorUsername || "system"}</strong></span>
                    {ev.ipAddress && <span className="text-gray-400">({ev.ipAddress})</span>}
                  </div>
                  {ev.metadata && (
                    <pre className="text-[10px] bg-white p-2 rounded-lg border border-[#E6E0D2] text-[#654735] overflow-x-auto">
                      {JSON.stringify(ev.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 bg-gray-50 border-t border-[#E6E0D2] flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-[#1A2E20] hover:bg-gray-200 rounded-xl transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
