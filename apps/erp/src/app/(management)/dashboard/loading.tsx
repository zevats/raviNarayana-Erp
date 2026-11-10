import { NavSkeleton } from "@/components/layout/shell/NavSkeleton";

/** Shown at once (inside the app frame) while the dashboard figures are prepared on the server. */
export default function DashboardLoading() {
  return <NavSkeleton href="/dashboard" title="Dashboard" />;
}
