import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { ErpShell } from "@/components/layout/ErpShell";
import { getDb } from "@/server/database/db";

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

  const user = validateSession(sessionToken);

  if (!user) {
    redirect("/login");
  }

  let isDemoData = process.env.NODE_ENV !== "production";
  try {
    const db = getDb();
    const manifestTable = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='seed_manifest'").get() as { count: number };
    if (manifestTable && manifestTable.count > 0) {
      const manifestCount = db.prepare("SELECT count(*) as count FROM seed_manifest").get() as { count: number };
      isDemoData = manifestCount.count > 0 || isDemoData;
    }
  } catch {
    // Graceful fallback
  }

  return <ErpShell user={user} isDemo={isDemoData}>{children}</ErpShell>;
}
