import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { validateSessionCached } from "@/server/authentication/cachedAuth";
import { hasPermission } from "@/server/authorization/permissions";
import { StaffDirectoryView } from "@/modules/staff/components/StaffDirectoryView";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  const user = await validateSessionCached(sessionToken);
  if (!user) {
    redirect("/login");
  }

  // Strict server-side RBAC assertion: only Owner (SUPER_ADMIN) can access /staff
  if (user.role !== "SUPER_ADMIN") {
    redirect("/dashboard");
  }

  return <StaffDirectoryView currentUser={user} />;
}
