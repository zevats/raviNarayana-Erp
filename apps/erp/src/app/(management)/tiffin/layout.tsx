import { requirePagePermission } from "@/server/authorization/pageGuard";

export default async function TiffinLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("tiffin.read");
  return <>{children}</>;
}
