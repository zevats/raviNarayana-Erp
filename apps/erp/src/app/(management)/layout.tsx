import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { validateSessionCached } from "@/server/authentication/cachedAuth";
import { ErpShell } from "@/components/layout/ErpShell";
import { checkDemoProvenance } from "@/server/database/db";
import { ERP_PATHNAME_HEADER, sectionRedirectFor } from "@/server/authorization/sectionAccess";
import { getSettings } from "@/server/settings/settingsService";

export const dynamic = "force-dynamic";

export default async function ManagementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value;

  if (!sessionToken) {
    redirect("/login");
  }

  const user = await validateSessionCached(sessionToken);

  if (!user) {
    redirect("/login");
  }

  // Runs before the loading boundary, so a role sent elsewhere gets a real redirect instead of a
  // fully rendered page that redirects in the browser.
  const pathname = headers().get(ERP_PATHNAME_HEADER);
  const elsewhere = pathname ? sectionRedirectFor(user.role, pathname) : null;
  if (elsewhere) {
    redirect(elsewhere);
  }

  const isDev = process.env.NODE_ENV !== "production";
  const isDemoData = isDev ? true : await checkDemoProvenance();

  // A settings read failure must never take the whole ERP down; the link is then just hidden.
  const websiteUrl = await getSettings().then((s) => s.business.websiteUrl || null).catch(() => null);

  return <ErpShell user={user} isDemo={isDemoData} websiteUrl={websiteUrl}>{children}</ErpShell>;
}
