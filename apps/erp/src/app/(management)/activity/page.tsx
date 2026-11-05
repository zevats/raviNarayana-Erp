import { PageHeader } from "@/components/ui/kit";
import { requirePagePermission } from "@/server/authorization/pageGuard";
import { ActivityLogView } from "@/modules/activity/ActivityLogView";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  // Owner only (system.manage); the API enforces the same.
  await requirePagePermission("system.manage");
  return (
    <div className="space-y-5 min-w-0">
      <PageHeader title="Activity log" description="Everything staff did, newest first. Entries cannot be changed." />
      <ActivityLogView />
    </div>
  );
}
