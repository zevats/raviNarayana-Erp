import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
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

  const user = await validateSession(sessionToken);

  if (!user) {
    redirect("/login");
  }

  let isDemoData = process.env.NODE_ENV !== "production";
  const hasDemoManifest = await checkDemoProvenance();
  isDemoData = hasDemoManifest || isDemoData;

  return <ErpShell user={user} isDemo={isDemoData}>{children}</ErpShell>;
}
