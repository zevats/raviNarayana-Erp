import { friendlyError } from "@/lib/friendlyError";
import { NextRequest, NextResponse } from "next/server";
import { databaseErrorResponse } from "@/server/database/availability";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  listDeliveryTasks,
  createExternalDeliveryTask,
  getDeliveryDashboardSummary,
  listActiveDeliveryStaff,
} from "@/server/delivery/deliveryService";
import { MealType, DeliveryStatus, DeliveryOrderType } from "@/types";
import { getClientIp } from "@/server/authentication/ip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const serviceDate = url.searchParams.get("serviceDate") || undefined;
    const mealType = (url.searchParams.get("mealType") as MealType) || undefined;
    const status = (url.searchParams.get("status") as DeliveryStatus) || undefined;
    const assignedTo = url.searchParams.get("assignedTo") || undefined;
    const orderType = (url.searchParams.get("orderType") as DeliveryOrderType) || undefined;
    const search = url.searchParams.get("search") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;
    const includeSummary = url.searchParams.get("includeSummary") === "true";
    const includeStaff = url.searchParams.get("includeStaff") === "true";

    const [tasks, summary, staff] = await Promise.all([
      listDeliveryTasks(user, {
        serviceDate,
        mealType,
        status,
        assignedTo,
        orderType,
        search,
        limit,
        offset,
      }),
      includeSummary && serviceDate
        ? getDeliveryDashboardSummary(user, serviceDate, mealType || "ALL")
        : Promise.resolve(null),
      includeStaff ? listActiveDeliveryStaff(user) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      tasks,
      ...(summary ? { summary } : {}),
      ...(staff ? { staff } : {}),
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;
    const dbError = databaseErrorResponse("/api/delivery/tasks", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to load delivery tasks.") },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const clientIp = getClientIp(request);
    const body = await request.json().catch(() => ({}));

    const task = await createExternalDeliveryTask(
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
    const dbError = databaseErrorResponse("/api/delivery/tasks", error);
    if (dbError) return dbError;

    return NextResponse.json(
      { error: friendlyError(error.message || "Failed to create external delivery task.") },
      { status: 400 }
    );
  }
}
