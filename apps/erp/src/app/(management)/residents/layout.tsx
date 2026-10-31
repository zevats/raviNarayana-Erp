import { requirePagePermission } from "@/server/authorization/pageGuard";

export default async function ResidentsLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("residents.read");
  return <>{children}</>;
}
