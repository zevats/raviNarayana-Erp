import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import { listDeliveryTasks, createExternalDeliveryTask } from "@/server/delivery/deliveryService";
import { MealType, DeliveryStatus, DeliveryOrderType } from "@/types";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const serviceDate = url.searchParams.get("serviceDate") || undefined;
    const mealType = (url.searchParams.get("mealType") as MealType) || undefined;
    const status = (url.searchParams.get("status") as DeliveryStatus) || undefined;
    const assignedTo = url.searchParams.get("assignedTo") || undefined;
    const orderType = (url.searchParams.get("orderType") as DeliveryOrderType) || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

    const tasks = listDeliveryTasks(user, {
      serviceDate,
      mealType,
      status,
      assignedTo,
      orderType,
      limit,
      offset,
    });

    return NextResponse.json({ success: true, tasks });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load delivery tasks." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const task = createExternalDeliveryTask(
      user,
      {
        serviceDate: body.serviceDate,
        mealType: body.mealType,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        deliveryAddress: body.deliveryAddress,
        notes: body.notes,
      },
      clientIp
    );

    return NextResponse.json({ success: true, task }, { status: 201 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to create external delivery task." },
      { status: 400 }
    );
  }
}
