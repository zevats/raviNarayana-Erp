import { requirePagePermission } from "@/server/authorization/pageGuard";

export default async function RoomsLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission("rooms.read");
  return <>{children}</>;
}
