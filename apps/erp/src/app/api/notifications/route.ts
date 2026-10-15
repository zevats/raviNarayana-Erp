import { NextRequest, NextResponse } from "next/server";
import {
  resolveUserFromRequest,
  unauthorizedResponse,
  handleAuthorizationError,
} from "@/server/authorization/authorize";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/server/notifications/notificationService";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const url = new URL(request.url);
    const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 30;
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";

    const data = getNotifications(user, { limit, unreadOnly });

    return NextResponse.json({
      success: true,
      notifications: data.notifications,
      unreadCount: data.unreadCount,
    });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to load notifications." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = resolveUserFromRequest(request);
    if (!user) return unauthorizedResponse();

    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (action === "mark_read") {
      if (!body.notificationId) {
        return NextResponse.json({ error: "notificationId is required." }, { status: 400 });
      }
      markNotificationAsRead(user, body.notificationId);
      return NextResponse.json({ success: true, notificationId: body.notificationId });
    }

    if (action === "mark_all_read") {
      markAllNotificationsAsRead(user);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  } catch (error: any) {
    const authError = handleAuthorizationError(error);
    if (authError) return authError;

    return NextResponse.json(
      { error: error.message || "Failed to process notification action." },
      { status: 500 }
    );
  }
}
