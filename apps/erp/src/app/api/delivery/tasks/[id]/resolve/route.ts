import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { resolveDeliveryProblem } from "@/server/delivery/deliveryOps";
import { deliveryRouteError } from "@/server/delivery/routeError";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

/** Close the follow-up on a partial or undelivered delivery: { note }. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();
    const body = await request.json().catch(() => ({}));
    const task = await resolveDeliveryProblem(user, params.id, { note: body.note }, getClientIp(request));
    return NextResponse.json({ success: true, task });
  } catch (error: any) {
    return deliveryRouteError("/api/delivery/tasks/[id]/resolve", error, "Could not resolve the delivery.");
  }
}
