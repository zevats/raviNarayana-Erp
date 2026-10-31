"use client";

import React, { createContext, useContext } from "react";
import { AuthenticatedUser, Permission } from "@/types";
import { hasPermission } from "@/server/authorization/permissions";

const CurrentUserContext = createContext<AuthenticatedUser | null>(null);

export function CurrentUserProvider({ user, children }: { user: AuthenticatedUser; children: React.ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): AuthenticatedUser | null {
  return useContext(CurrentUserContext);
}

/**
 * UI-only permission check mirroring the server's ROLE_PERMISSIONS. Used to hide actions the
 * server would reject; it is never a security control (services call requirePermission).
 */
export function useHasPermission(permission: Permission): boolean {
  const user = useContext(CurrentUserContext);
  return hasPermission(user?.role, permission);
}
