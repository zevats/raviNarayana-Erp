import { hasPermission } from "./permissions";

/** Request header carrying the page path from the middleware to the management layout. */
export const ERP_PATHNAME_HEADER = "x-erp-pathname";

/**
 * Where a role must go instead of `pathname`, or null when the section is theirs.
 * Used by the management layout to redirect before the page streams (a real 307 instead of a
 * client-side redirect after a full render). The APIs and per-section guards still enforce access.
 */
export function sectionRedirectFor(role: string, pathname: string): string | null {
  const fallback = role === "DELIVERY_PERSON" ? "/delivery" : "/dashboard";
  const inSection = (prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

  // Everyone manages their own account (profile, password, email).
  if (inSection("/account")) return null;
  if (role === "DELIVERY_PERSON") {
    return inSection("/delivery") ? null : "/delivery";
  }
  if (inSection("/staff")) return role === "SUPER_ADMIN" ? null : fallback;
  if (inSection("/rooms")) return hasPermission(role, "rooms.read") ? null : fallback;
  if (inSection("/residents")) return hasPermission(role, "residents.read") ? null : fallback;
  if (inSection("/finance")) return hasPermission(role, "finance.read") ? null : fallback;
  return null;
}
