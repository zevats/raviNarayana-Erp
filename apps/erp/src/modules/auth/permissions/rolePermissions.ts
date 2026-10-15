import { StaffRole } from "@/types";

export type Permission =
  | "system:manage"
  | "staff:read"
  | "staff:write"
  | "rooms:read"
  | "rooms:write"
  | "residents:read"
  | "residents:write"
  | "finance:read"
  | "finance:write"
  | "kitchen:read"
  | "kitchen:write"
  | "delivery:read"
  | "delivery:write"
  | "delivery:execute"
  | "reports:read"
  | "audit:read";

export const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  SUPER_ADMIN: [
    "system:manage",
    "staff:read",
    "staff:write",
    "rooms:read",
    "rooms:write",
    "residents:read",
    "residents:write",
    "finance:read",
    "finance:write",
    "kitchen:read",
    "kitchen:write",
    "delivery:read",
    "delivery:write",
    "delivery:execute",
    "reports:read",
    "audit:read",
  ],
  OPERATIONS_MANAGER: [
    "staff:read",
    "rooms:read",
    "rooms:write",
    "residents:read",
    "residents:write",
    "finance:read",
    "kitchen:read",
    "kitchen:write",
    "delivery:read",
    "delivery:write",
    "delivery:execute",
    "reports:read",
  ],
  ACCOUNTANT: [
    "rooms:read",
    "residents:read",
    "finance:read",
    "finance:write",
    "reports:read",
  ],
  KITCHEN_OPERATIONS: [
    "kitchen:read",
    "kitchen:write",
    "delivery:read",
  ],
  DELIVERY_PERSON: [
    "delivery:read",
    "delivery:execute",
  ],
};

export function hasPermission(role: StaffRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}
