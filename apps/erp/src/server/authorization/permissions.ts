import { StaffRole, Permission } from "@/types";

export const ALL_ROLES: readonly StaffRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_MANAGER",
  "ACCOUNTANT",
  "KITCHEN_OPERATIONS",
  "DELIVERY_PERSON",
] as const;

export const CANONICAL_ROLES: readonly StaffRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_MANAGER",
  "DELIVERY_PERSON",
] as const;

export const ALL_PERMISSIONS: readonly Permission[] = [
  // Staff Administration
  "staff.read",
  "staff.create",
  "staff.update",
  "staff.deactivate",
  "staff.assign_role",
  // Audit & System Governance
  "audit.read",
  "system.manage",
  // Operational Module Permissions (Standardized Phase 3-6 naming conventions)
  "rooms.read",
  "rooms.manage",
  "residents.read",
  "residents.manage",
  "finance.read",
  // Day-to-day entry of rent charges/payments, security deposits and expenses (Owner + Manager).
  "finance.record",
  // Owner-level finance authority: reversals, closings, invoices, settlements, billing runs.
  "finance.manage",
  "tiffin.read",
  "tiffin.manage",
  "kitchen.read",
  "kitchen.manage",
  "delivery.read",
  "delivery.manage",
  "delivery.update",
] as const;

/**
 * Strict Least-Privilege Role-to-Permission Mapping
 */
export const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set<Permission>([
    "staff.read",
    "staff.create",
    "staff.update",
    "staff.deactivate",
    "staff.assign_role",
    "audit.read",
    "system.manage",
    "rooms.read",
    "rooms.manage",
    "residents.read",
    "residents.manage",
    "finance.read",
    "finance.record",
    "finance.manage",
    "tiffin.read",
    "tiffin.manage",
    "kitchen.read",
    "kitchen.manage",
    "delivery.read",
    "delivery.manage",
    "delivery.update",
  ]),

  OPERATIONS_MANAGER: new Set<Permission>([
    "staff.read",
    "rooms.read",
    "rooms.manage",
    "residents.read",
    "residents.manage",
    "finance.read",
    "finance.record",
    "tiffin.read",
    "tiffin.manage",
    "kitchen.read",
    "kitchen.manage",
    "delivery.read",
    "delivery.manage",
    "delivery.update",
    "audit.read",
  ]),

  ACCOUNTANT: new Set<Permission>([
    "residents.read",
    "finance.read",
    "finance.record",
    "finance.manage",
    "audit.read",
  ]),

  KITCHEN_OPERATIONS: new Set<Permission>([
    "kitchen.read",
    "kitchen.manage",
    "tiffin.read",
  ]),

  DELIVERY_PERSON: new Set<Permission>([
    "delivery.read",
    "delivery.update",
  ]),
};

/**
 * Checks whether a given role holds the requested permission.
 * Fails closed if the role is null, undefined, not recognized, or lacks the permission.
 */
export function hasPermission(role: string | undefined | null, permission: Permission): boolean {
  if (!role || typeof role !== "string") {
    return false;
  }
  const permissions = ROLE_PERMISSIONS[role as StaffRole];
  if (!permissions) {
    return false;
  }
  return permissions.has(permission);
}

/**
 * Returns the set of permissions granted to a given role.
 * Fails closed with an empty set if the role is null, undefined, or unrecognized.
 */
export function getRolePermissions(role: string | undefined | null): ReadonlySet<Permission> {
  if (!role || typeof role !== "string") {
    return new Set();
  }
  return ROLE_PERMISSIONS[role as StaffRole] || new Set();
}

/**
 * Whether a role may be newly assigned (staff creation or role change). Only the Task 01B.69
 * canonical roles qualify. Legacy roles (ACCOUNTANT, KITCHEN_OPERATIONS) stay valid for existing
 * accounts, which keep their permissions, but cannot be granted again.
 */
export function isAssignableRole(role: string | undefined | null): role is StaffRole {
  if (!role) return false;
  return CANONICAL_ROLES.includes(role as StaffRole);
}

/**
 * Validates whether a string is a recognized StaffRole.
 */
export function isValidRole(role: string | undefined | null): role is StaffRole {
  if (!role) return false;
  return ALL_ROLES.includes(role as StaffRole);
}
