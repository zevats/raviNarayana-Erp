import { requirePagePermission } from "@/server/authorization/pageGuard";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("finance.read");
  return <>{children}</>;
}
