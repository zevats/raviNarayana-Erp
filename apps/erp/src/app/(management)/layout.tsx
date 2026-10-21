import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { validateSessionCached } from "@/server/authentication/cachedAuth";
import { ErpShell } from "@/components/layout/ErpShell";
import { checkDemoProvenance } from "@/server/database/db";

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

  const isDev = process.env.NODE_ENV !== "production";
  const isDemoData = isDev ? true : await checkDemoProvenance();

  return <ErpShell user={user} isDemo={isDemoData}>{children}</ErpShell>;
}
