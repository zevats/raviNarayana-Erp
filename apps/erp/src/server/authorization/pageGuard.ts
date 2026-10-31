import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { validateSessionCached } from "@/server/authentication/cachedAuth";
import { hasPermission } from "./permissions";
import { Permission } from "@/types";

/**
 * Server-side page gate for management sections. The APIs already refuse roles without the
 * permission; this keeps such roles off the page itself instead of showing an empty shell.
 * The session lookup is request-memoized, so this adds no query after the management layout.
 */
export async function requirePagePermission(permission: Permission): Promise<void> {
  const sessionToken = cookies().get(ERP_COOKIE_NAME)?.value;
  const user = sessionToken ? await validateSessionCached(sessionToken) : null;
  if (!user) {
    redirect("/login");
  }
  if (!hasPermission(user.role, permission)) {
    redirect(user.role === "DELIVERY_PERSON" ? "/delivery" : "/dashboard");
  }
}
