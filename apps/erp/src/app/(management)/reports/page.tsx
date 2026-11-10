import { PageHeader } from "@/components/ui/kit";
import { requirePagePermission } from "@/server/authorization/pageGuard";
import { ReportsView } from "@/modules/reports/components/ReportsView";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  // Owner and Manager; each report also checks its own permission on the server.
  await requirePagePermission("finance.read");
  return (
    <div className="space-y-5 min-w-0">
      <PageHeader title="Reports" />
      <ReportsView />
    </div>
  );
}
