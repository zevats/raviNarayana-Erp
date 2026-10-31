import { NextRequest } from "next/server";
import { resolveUserFromRequest, unauthorizedResponse } from "@/server/authorization/authorize";
import { onBusinessDataChanged } from "@/server/database/changeSignals";
import { ERP_COOKIE_NAME, validateSession } from "@/server/authentication/auth";

export const dynamic = "force-dynamic";

/** Which client cache tags a committed write to a table makes stale. */
const TABLE_TAGS: Record<string, string[]> = {
  orders: ["orders", "delivery", "dashboard"],
  order_items: ["orders", "delivery", "dashboard"],
  delivery_tasks: ["delivery", "orders", "dashboard"],
  delivery_task_events: ["delivery"],
  driver_cash_handovers: ["custody", "handover", "delivery", "finance", "dashboard"],
  delivery_collections: ["custody", "handover", "delivery"],
  delivery_task_items: ["delivery", "orders"],
  subscription_day_overrides: ["delivery", "orders", "subscriptions"],
  daily_meal_plans: ["delivery"],
  resident_meal_records: ["delivery", "residents"],
  resident_meal_preferences: ["delivery", "residents"],
  tiffin_subscriptions: ["subscriptions", "orders", "delivery"],
  financial_transactions: ["finance", "dashboard"],
  invoices: ["finance", "invoices", "dashboard"],
  invoice_items: ["finance", "invoices"],
  daily_cashbook_closings: ["finance", "dashboard"],
  tiffin_customers: ["customers", "orders"],
  tiffin_products: ["products"],
  rooms: ["rooms", "dashboard"],
  residents: ["residents", "rooms", "dashboard"],
  resident_stays: ["residents", "rooms", "dashboard"],
  staff_users: ["staff"],
};

/**
 * Live updates (Server-Sent Events). After any committed business write in this server process,
 * signed-in browsers receive the cache tags it affects and refetch those views. Messages carry
 * tag names only, never data; every view still loads through its permission-checked API.
 * Limitation: signals are per server process (one `next dev`/`next start` instance). The 20 s
 * polling on Orders and Delivery remains as the fallback.
 */
export async function GET(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return unauthorizedResponse();
  const sessionToken = request.cookies.get(ERP_COOKIE_NAME)?.value || "";
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending = new Set<string>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const unsubscribe = onBusinessDataChanged((tables) => {
        for (const t of tables.length ? tables : ["*"]) {
          for (const tag of TABLE_TAGS[t] ?? ["dashboard"]) pending.add(tag);
        }
        if (flushTimer) return;
        // Merge a burst of writes (one transaction, several requests) into one message.
        flushTimer = setTimeout(() => {
          flushTimer = null;
          const tags = Array.from(pending);
          pending = new Set();
          send(`event: changed\ndata: ${JSON.stringify({ tags, at: Date.now() })}\n\n`);
        }, 250);
      });
      // Heartbeat keeps the connection open through proxies and ends it once the session is gone
      // (signed out, revoked or replaced by a sign-in elsewhere).
      const heartbeat = setInterval(async () => {
        const stillValid = await validateSession(sessionToken).catch(() => null);
        if (!stillValid) {
          send(`event: signed-out\ndata: {}\n\n`);
          cleanup();
          return;
        }
        send(`: ping ${Date.now()}\n\n`);
      }, 25000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        if (flushTimer) clearTimeout(flushTimer);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", () => cleanup());
      send(`retry: 3000\nevent: ready\ndata: {}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
