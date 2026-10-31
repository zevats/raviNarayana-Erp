import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { cancelDeliveryTask } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Cancel a delivery: { reason, overrideCutoff } (after the meal cutoff the override must be confirmed). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const task = await cancelDeliveryTask(user, params.id, { reason: body.reason, overrideCutoff: body.overrideCutoff === true }, getClientIp(request));
    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/tasks/[id]/cancel", error, "Could not cancel the delivery.");
  }
}
