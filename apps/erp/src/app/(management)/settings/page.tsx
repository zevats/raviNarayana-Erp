import { PageHeader } from "@/components/ui/kit";
import { requirePagePermission } from "@/server/authorization/pageGuard";
import { SettingsView } from "@/modules/settings/SettingsView";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Owner only (system.manage); the API enforces the same.
  await requirePagePermission("system.manage");
  return (
    <div className="space-y-5 min-w-0">
      <PageHeader title="Settings" />
      <SettingsView />
    </div>
  );
}
