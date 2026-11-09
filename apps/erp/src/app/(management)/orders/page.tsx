"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useCallback, useMemo, useDeferredValue } from "react";
import {
  ShoppingBag,
  Plus,
  Search,
  Filter,
  RefreshCw,
  Truck,
  Utensils,
  CheckCircle2,
  Clock,
  AlertTriangle,
  MapPin,
  Phone,
  Calendar,
  CreditCard,
  ChevronRight,
  BookOpen,
  Users,
} from "lucide-react";
import { UnifiedOrder, TiffinCustomer } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import Link from "next/link";
import { businessToday } from "@/lib/businessDate";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { PageHeader, Segmented, StatStrip, SearchField, EmptyState } from "@/components/ui/kit";
import dynamic from "next/dynamic";
import { preloadWhenIdle } from "@/lib/preloadWhenIdle";
import { RefreshButton } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";
import type { PendingOrderJob } from "@/modules/orders/components/NewOrderModal";

// Dialogs and secondary views load on demand, off the navigation path.
const loadNewOrderModal = () => import("@/modules/orders/components/NewOrderModal");
const NewOrderModal = dynamic(() => loadNewOrderModal().then((m) => m.NewOrderModal), { ssr: false });
const loadEditOrderModal = () => import("@/modules/orders/components/EditOrderModal");
const EditOrderModal = dynamic(() => loadEditOrderModal().then((m) => m.EditOrderModal), { ssr: false });
const loadSubscriptionsToday = () => import("@/modules/delivery/ops/SubscriptionsToday");
const SubscriptionsToday = dynamic(() => loadSubscriptionsToday().then((m) => m.SubscriptionsToday), { ssr: false });
const loadMenuCatalog = () => import("@/modules/delivery/ops/MenuCatalog");
const MenuCatalog = dynamic(() => loadMenuCatalog().then((m) => m.MenuCatalog), { ssr: false });

// Orders change through delivery completion by other staff; 20s keeps the board current.
const ORDERS_POLL_MS = 20000;

export default function OrdersPage() {
  // Fetch the dialog and tab code in the background so the first click opens at once.
  useEffect(() => preloadWhenIdle([loadNewOrderModal, loadEditOrderModal, loadSubscriptionsToday, loadMenuCatalog]), []);
  // Signed-in user from the server-rendered shell (no /api/auth/me round-trip).
  const currentUser = useCurrentUser();
  const [serviceDate, setServiceDate] = useState(businessToday());
  const [orderTypeFilter, setOrderTypeFilter] = useState<"ALL" | "DELIVERY" | "DINE_IN">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  // Subscriptions → Take order: the order form opens with that subscriber chosen.
  const [presetCustomer, setPresetCustomer] = useState<TiffinCustomer | null>(null);
  // Change / cancel one delivery order (only while it has not gone out and nothing was collected).
  const [editing, setEditing] = useState<{ order: UnifiedOrder; mode: "edit" | "cancel" } | null>(null);
  const [orderNotice, setOrderNotice] = useState<string | null>(null);
  // Orders confirmed in the form and still being saved (the form closes at once). A failed save
  // stays here with its reason and a Retry that sends the same order again (same key: recorded once).
  const [pending, setPending] = useState<Array<PendingOrderJob & { status: "saving" | "failed"; error?: string }>>([]);
  const runPending = useCallback((job: PendingOrderJob) => {
    setPending((list) => [{ ...job, status: "saving" as const }, ...list.filter((j) => j.key !== job.key)]);
    job
      .run()
      .then((message) => {
        setPending((list) => list.filter((j) => j.key !== job.key));
        setOrderNotice(message);
        invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
      })
      .catch((e: any) => {
        setPending((list) => list.map((j) => (j.key === job.key ? { ...j, status: "failed" as const, error: e?.message || "Could not save the order." } : j)));
        setOrderNotice(`Order for ${job.customerName} was not saved: ${e?.message || "try again"}. Open Today to retry.`);
      });
  }, []);
  // Leaving the page while an order is still being sent would lose it: ask first.
  useEffect(() => {
    if (!pending.some((j) => j.status === "saving")) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  // Each confirmation stays 5 s; a newer one restarts the timer instead of being cut short.
  useEffect(() => {
    if (!orderNotice) return;
    const t = setTimeout(() => setOrderNotice(null), 5000);
    return () => clearTimeout(t);
  }, [orderNotice]);
  const [activeSection, setActiveSection] = useState<"DAILY_ORDERS" | "SUBSCRIPTIONS" | "MENU_CATALOG">("DAILY_ORDERS");


  // Orders are cached per date and type and reused across visits; refreshed every 20s while the
  // tab is visible (orders also change through delivery completion), on focus, and after mutations.
  // Search and status filter the loaded day in the browser: no request per keystroke.
  const ordersKey = `/api/orders?${new URLSearchParams({ serviceDate, orderType: orderTypeFilter }).toString()}`;
  const deferredSearch = useDeferredValue(searchQuery);
  const ordersQuery = useErpQuery<{ orders: UnifiedOrder[]; counts: { today: number; active: number; completed: number } }>(
    ordersKey,
    async () => {
      const res = await fetch(ordersKey);
      if (!res.ok) throw new Error("Failed to load orders");
      const data = await res.json();
      return { orders: data.orders || [], counts: data.counts || { today: 0, active: 0, completed: 0 } };
    },
    { ttl: ORDERS_POLL_MS, tags: ["orders"], pollIntervalMs: ORDERS_POLL_MS }
  );
  const orders = ordersQuery.data?.orders ?? [];
  const counts = ordersQuery.data?.counts ?? { today: 0, active: 0, completed: 0 };
  // First load shows the placeholder; background refreshes only spin the refresh icon.
  const isLoading = ordersQuery.isLoading && !ordersQuery.data;
  const isRefreshing = ordersQuery.isLoading || ordersQuery.isRevalidating;
  const refreshOrders = useCallback(() => {
    invalidateErpCache(["orders"]);
  }, []);

  useEffect(() => {
    const handleFocus = () => ordersQuery.refetch();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [ordersQuery.refetch]);

  const filteredOrders = useMemo(() => {
    // Same match as the server's search (name, phone, address).
    const search = deferredSearch.toLowerCase().trim();
    return orders.filter((o) => {
      if (
        search &&
        !(
          o.customerName.toLowerCase().includes(search) ||
          (o.customerPhone && o.customerPhone.includes(search)) ||
          (o.deliveryAddress && o.deliveryAddress.toLowerCase().includes(search))
        )
      ) {
        return false;
      }
      if (statusFilter !== "ALL") {
        if (statusFilter === "ACTIVE" && !(o.orderStatus === "CONFIRMED" || o.orderStatus === "OUT_FOR_DELIVERY")) {
          return false;
        }
        if (statusFilter === "COMPLETED" && !(o.orderStatus === "DELIVERED" || o.orderStatus === "COMPLETED")) {
          return false;
        }
      }
      return true;
    });
  }, [orders, statusFilter, deferredSearch]);

  // Busy days can have hundreds of orders: draw them in pages so opening and filtering stay quick.
  // Search and filters always cover the whole day.
  const PAGE = 60;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [serviceDate, orderTypeFilter, statusFilter, deferredSearch]);
  const visibleOrders = filteredOrders.length > shown ? filteredOrders.slice(0, shown) : filteredOrders;
  // Each order of the day gets a short number in the order it was taken (#1 is the first), so it
  // can be told apart and called out ("order 12") at a glance.
  const orderNo = useMemo(() => {
    const m = new Map<string, number>();
    [...orders].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((o, i) => m.set(o.id, i + 1));
    return m;
  }, [orders]);

  return (
    <div className="space-y-5 min-w-0">
      <PageHeader
        title="Orders"
        actions={
          <>
            <Segmented
              label="Orders sections"
              value={activeSection}
              onChange={setActiveSection}
              options={[
                { value: "DAILY_ORDERS", label: "Today", count: counts.today },
                { value: "SUBSCRIPTIONS", label: "Subscriptions" },
                { value: "MENU_CATALOG", label: "Menu" },
              ]}
            />
            <button type="button" onClick={() => setIsNewOrderModalOpen(true)} className="rn-btn rn-btn-primary">
              <Plus /> New order
            </button>
          </>
        }
      />

      {activeSection === "DAILY_ORDERS" && (
        <StatStrip
          items={[
            { label: "Today", value: counts.today },
            { label: "In progress", value: counts.active },
            { label: "Completed", value: counts.completed, tone: "good" },
          ]}
        />
      )}

      {activeSection === "DAILY_ORDERS" && (
        <div className="rn-card">
          <div className="p-4 sm:p-5 border-b border-[var(--rn-line)] flex flex-wrap items-center gap-2.5">
            <SearchField value={searchQuery} onChange={setSearchQuery} placeholder="Search name, phone or address" className="flex-1 basis-[240px]" />
            <div className="flex items-center gap-2 flex-wrap">
              <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} aria-label="Service date" className="rn-input" />
              <AppSelect value={orderTypeFilter} onChange={(e) => setOrderTypeFilter(e.target.value as any)} aria-label="Order type" className="rn-input">
                <option value="ALL">All orders</option>
                <option value="DELIVERY">Delivery</option>
                <option value="DINE_IN">Dine in</option>
              </AppSelect>
              <AppSelect value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status" className="rn-input">
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">In progress</option>
                <option value="COMPLETED">Completed</option>
              </AppSelect>
              <RefreshButton onRefresh={refreshOrders} busy={isRefreshing} label="Refresh orders" />
            </div>
          </div>

          {pending.length > 0 && (
            <ul className="border-b border-[var(--rn-line)] divide-y divide-[var(--rn-line)]" aria-label="Orders being saved">
              {pending.map((j) => (
                <li key={j.key} className={`px-4 sm:px-5 py-3.5 flex flex-wrap items-center gap-3 ${j.status === "failed" ? "bg-[#FDECEA]" : "bg-[var(--rn-accent-tint)]"}`}>
                  {j.status === "saving" ? (
                    <span className="w-5 h-5 rounded-full border-2 border-[var(--rn-accent)] border-t-transparent animate-spin shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-[#A3261A] shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-[var(--rn-ink)] truncate">
                      {j.customerName} · ₹{j.total.toLocaleString("en-IN")}
                      <span className="ml-2 text-[12.5px] font-medium text-[var(--rn-ink-2)]">{j.orderType === "DELIVERY" ? "Delivery" : "Dine in"} · {j.mealType.charAt(0) + j.mealType.slice(1).toLowerCase()}</span>
                    </p>
                    <p className={`text-[12.5px] truncate ${j.status === "failed" ? "text-[#8A1F12] font-medium" : "text-[var(--rn-ink-2)]"}`}>
                      {j.status === "saving" ? `Saving… ${j.itemsText}` : `Not saved: ${j.error}`}
                    </p>
                  </div>
                  {j.status === "failed" && (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => runPending(j)} className="h-9 px-4 rounded-full bg-[var(--rn-accent)] text-white text-[13px] font-semibold">
                        Retry
                      </button>
                      <button type="button" onClick={() => setPending((list) => list.filter((x) => x.key !== j.key))} className="h-9 px-3 rounded-full text-[13px] font-semibold text-[var(--rn-ink-2)] hover:bg-white/60">
                        Dismiss
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* ORDER CARDS LIST */}
          {isLoading ? (
            <BikeLoader label="Loading orders" className="py-12" />
          ) : filteredOrders.length === 0 ? (
            <EmptyState title="No orders for this date">
              Nothing matches these filters. Use New order at the top to add one.
            </EmptyState>
          ) : (
            <div className="rn-order-cards p-3 sm:p-4 space-y-3">
              {visibleOrders.map((order) => {
                const isDelivery = order.orderType === "DELIVERY";
                return (
                  <div
                    key={order.id}
                    data-order-id={order.id}
                    className="relative overflow-hidden rounded-[20px] bg-white border border-[var(--rn-line)] shadow-[0_1px_2px_rgba(40,20,10,0.06),0_10px_24px_-18px_rgba(40,20,10,0.35)] p-4 pl-5 sm:p-5 sm:pl-6 space-y-3"
                  >
                    {/* Status colour down the left edge: each order reads as its own card. */}
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 bottom-0 w-1.5"
                      style={{
                        background:
                          order.orderStatus === "CANCELLED"
                            ? "#B9B2A8"
                            : order.orderStatus === "EXCEPTION"
                            ? "#C93A22"
                            : order.orderStatus === "DELIVERED" && order.deliveryOutcome === "PARTIAL"
                            ? "#D99A1E"
                            : order.orderStatus === "DELIVERED" || order.orderStatus === "COMPLETED"
                            ? "#3C8A2E"
                            : order.orderStatus === "OUT_FOR_DELIVERY"
                            ? "#4D56C9"
                            : "#3F78C9",
                      }}
                    />
                    {/* Top Row: Customer, Type Badge & Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {/* Icon badge */}
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-[var(--rn-accent-tint)] text-[var(--rn-accent)]"
                        >
                          {isDelivery ? <Truck className="w-5 h-5" /> : <Utensils className="w-5 h-5" />}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-extrabold tabular-nums px-2 py-0.5 rounded-md bg-[var(--rn-ink)] text-white">
                              #{orderNo.get(order.id) ?? "–"}
                            </span>
                            <span
                              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                                isDelivery
                                  ? "bg-[#1A2E20]/5 text-[#1A2E20] border border-[#1A2E20]/15"
                                  : "bg-[#B58A57]/10 text-[#8B6538] border border-[#B58A57]/30"
                              }`}
                            >
                              {isDelivery ? "Delivery" : "Dine In"}
                            </span>
                            <span className="text-[10px] font-mono text-[#8E9F89] uppercase">
                              {order.mealType}
                            </span>
                            <span className="text-[10px] font-mono text-[#8E9F89]">
                              {formatDateTime(order.createdAt, undefined, { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>

                          <h3 className="text-[17px] leading-snug text-[var(--rn-ink)] font-bold mt-1">
                            {order.customerName}
                          </h3>

                          {order.customerPhone && (
                            <p className="text-xs text-[#8E9F89] font-mono flex items-center gap-1">
                              <Phone className="w-3 h-3 text-[#B58A57]" />
                              {order.customerPhone}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right Status Badges */}
                      <div className="text-right space-y-1">
                        <div className="flex items-center justify-end gap-1.5">
                          {order.orderStatus === "CONFIRMED" && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1 bg-[#DCE9FA] text-[#163F73] border-[#A9C6EE]">
                              <Clock className="w-3 h-3" /> Confirmed
                            </span>
                          )}
                          {order.orderStatus === "OUT_FOR_DELIVERY" && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1 bg-[#E0E3FA] text-[#272F7A] border-[#B4BBEE]">
                              <Truck className="w-3 h-3 animate-pulse" /> Out for Delivery
                            </span>
                          )}
                          {order.orderStatus === "DELIVERED" && order.deliveryOutcome !== "PARTIAL" && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1 bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]">
                              <CheckCircle2 className="w-3 h-3" /> Delivered
                            </span>
                          )}
                          {order.orderStatus === "DELIVERED" && order.deliveryOutcome === "PARTIAL" && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1 bg-[#FBE9C4] text-[#5E3F04] border-[#EBC777]">
                              <AlertTriangle className="w-3 h-3" /> Partly delivered
                            </span>
                          )}
                          {order.orderStatus === "COMPLETED" && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1 bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]">
                              <CheckCircle2 className="w-3 h-3" /> {order.paymentStatus === "PAID" ? <>Paid &amp; Complete</> : "Served"}
                            </span>
                          )}
                          {order.orderStatus === "EXCEPTION" && (
                            <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1 bg-[#FAD9D2] text-[#7A1A0E] border-[#EBA597]">
                              <AlertTriangle className="w-3 h-3" /> {order.deliveryOutcome === "NONE" ? "Not delivered" : "Shortfall / Issue"}
                            </span>
                          )}
                        </div>

                        {/* Payment badge (delivery orders are due for what was delivered, at the saved prices) */}
                        {order.deliveryOutcome === "NONE" ? (
                          <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full inline-block bg-[#ECE8E2] text-[#3D3631] border border-[#D6CFC5]">
                            Nothing due
                          </span>
                        ) : (
                        <span
                          className={`text-[12px] font-bold px-2.5 py-1 rounded-full inline-block tabular-nums border ${
                            order.paymentStatus === "PAID"
                              ? "bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]"
                              : order.paymentStatus === "PARTIALLY_PAID"
                              ? "bg-[#FBE9C4] text-[#5E3F04] border-[#EBC777]"
                              : "bg-[#C93A22] text-white border-[#A82E19]"
                          }`}
                        >
                          {order.paymentStatus === "PAID"
                            ? `Paid ₹${order.amountDue ?? order.totalAmount}`
                            : order.paymentStatus === "PARTIALLY_PAID"
                            ? `Part paid ₹${order.collectedAmount} · ₹${order.remainingAmount} due`
                            : `Unpaid ₹${order.remainingAmount}`}
                        </span>
                        )}
                      </div>
                    </div>

                    {/* Delivery Address (if Delivery) */}
                    {isDelivery && order.deliveryAddress && (
                      <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
                        <span className="text-[#1A2E20] font-medium">{order.deliveryAddress}</span>
                        {order.assignedToName ? (
                          <span className="text-[var(--rn-ink-2)] ml-auto shrink-0">
                            {order.orderStatus === "DELIVERED" || order.orderStatus === "COMPLETED"
                              ? "Delivered by"
                              : order.orderStatus === "EXCEPTION"
                              ? "Attempted by"
                              : order.orderStatus === "OUT_FOR_DELIVERY"
                              ? "Out with"
                              : "Assigned to"}{" "}
                            <strong className="text-[var(--rn-ink)]">{order.assignedToName}</strong>
                          </span>
                        ) : (
                          <span className="text-amber-700 font-serif ml-auto shrink-0">Not assigned yet</span>
                        )}
                      </div>
                    )}

                    {/* Items Breakdown Strip */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E6E1DA]/60 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[#8E9F89] font-mono text-[11px]">Items:</span>
                        {order.items.map((it, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 bg-[#FAF8F5] border border-[#DCD6CD] rounded-md font-mono text-[11px] text-[#1A2E20]"
                          >
                            {it.quantity}x {it.productName} (₹{it.lineTotal})
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="font-serif text-sm font-bold text-[#1A2E20]">
                          Total: ₹{order.totalAmount}
                        </span>
                        {isDelivery &&
                          order.orderStatus !== "CANCELLED" &&
                          (order.deliveryStatus === "PENDING" || order.deliveryStatus === "ASSIGNED" || order.deliveryStatus === "OUT_FOR_DELIVERY") &&
                          !(order.collectedAmount && order.collectedAmount > 0) && (
                            <>
                              <button type="button" onClick={() => setEditing({ order, mode: "edit" })} className="h-9 px-3 rounded-full text-[12.5px] font-semibold text-[var(--rn-ink)] hover:bg-[var(--rn-accent-tint)]">
                                Change
                              </button>
                              <button type="button" onClick={() => setEditing({ order, mode: "cancel" })} className="h-9 px-3 rounded-full text-[12.5px] font-semibold text-[#A3261A] hover:bg-[#FBEDE8]">
                                Cancel order
                              </button>
                            </>
                          )}
                        {(order.revision ?? 0) > 0 && <span className="text-[11px] text-[#8E9F89]">Edited</span>}
                        {order.orderStatus === "CANCELLED" && order.cancelReason && (
                          <span className="text-[11px] text-rose-700">Cancelled: {order.cancelReason}</span>
                        )}
                        {isDelivery && (
                          <Link
                            href={`/delivery?tab=board&date=${order.serviceDate}&meal=${order.mealType}`}
                            className="ml-1 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-[var(--rn-accent)] text-[12.5px] font-semibold text-[var(--rn-accent)] hover:bg-[var(--rn-accent-tint)]"
                          >
                            View delivery <span aria-hidden>&rarr;</span>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filteredOrders.length > visibleOrders.length && (
                <div className="p-4 flex items-center justify-center gap-3">
                  <span className="text-[12.5px] text-[var(--rn-ink-3)] tabular-nums">Showing {visibleOrders.length} of {filteredOrders.length}</span>
                  <button type="button" className="rn-btn" onClick={() => setShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, filteredOrders.length - visibleOrders.length)} more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subscriptions: today's status, skip / extra for this meal, residents' room delivery */}
      {activeSection === "SUBSCRIPTIONS" && (
        <div className="rn-card p-4 sm:p-6">
          <SubscriptionsToday
            canChange={currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "OPERATIONS_MANAGER"}
            onTakeOrder={(customer) => {
              setPresetCustomer(customer);
              setIsNewOrderModalOpen(true);
            }}
          />
        </div>
      )}

      {/* Menu: the real catalogue and current prices */}
      {activeSection === "MENU_CATALOG" && (
        <div className="rn-card p-4 sm:p-6">
          <MenuCatalog />
        </div>
      )}

      {editing && (
        <EditOrderModal
          order={editing.order}
          mode={editing.mode}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setOrderNotice(message);
          }}
        />
      )}
      {orderNotice && (
        <div role="status" className="fixed bottom-6 left-4 z-40 px-4 py-2.5 rounded-xl bg-[#1A2E20] text-white text-sm shadow-lg">{orderNotice}</div>
      )}

      {/* Fast Order Entry Modal */}
      <NewOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => {
          setIsNewOrderModalOpen(false);
          setPresetCustomer(null);
        }}
        presetCustomer={presetCustomer}
        onOrderCreated={(message) => {
          setOrderNotice(message);
          invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
        }}
        onSubmitInBackground={runPending}
        defaultDate={serviceDate}
      />
    </div>
  );
}
