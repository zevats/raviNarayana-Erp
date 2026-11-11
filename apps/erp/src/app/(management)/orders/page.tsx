"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
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
import { OrderCard } from "@/modules/orders/components/OrderCard";
import { OrdersMobile } from "@/modules/orders/components/OrdersMobile";
import { PhoneOrDesktop, useIsPhone } from "@/components/app/m";
import type { PendingOrderJob } from "@/modules/orders/components/NewOrderModal";

// Dialogs and secondary views load on demand, off the navigation path.
const loadNewOrderModal = () => import("@/modules/orders/components/NewOrderModal");
const NewOrderModal = dynamic(() => loadNewOrderModal().then((m) => m.NewOrderModal), { ssr: false });
const loadEditOrderModal = () => import("@/modules/orders/components/EditOrderModal");
const ReassignDialog = dynamic(() => import("@/modules/orders/components/AssignTo").then((m) => m.ReassignDialog), { ssr: false });
const EditOrderModal = dynamic(() => loadEditOrderModal().then((m) => m.EditOrderModal), { ssr: false });
const loadMenuCatalog = () => import("@/modules/delivery/ops/MenuCatalog");
const MenuCatalog = dynamic(() => loadMenuCatalog().then((m) => m.MenuCatalog), { ssr: false });

// Orders change through delivery completion by other staff; 20s keeps the board current.
const ORDERS_POLL_MS = 20000;

export default function OrdersPage() {
  // Fetch the dialog and tab code in the background so the first click opens at once.
  useEffect(() => preloadWhenIdle([loadNewOrderModal, loadEditOrderModal, loadMenuCatalog]), []);
  // Signed-in user from the server-rendered shell (no /api/auth/me round-trip).
  const currentUser = useCurrentUser();
  const phone = useIsPhone();
  const [serviceDate, setServiceDate] = useState(businessToday());
  const [orderTypeFilter, setOrderTypeFilter] = useState<"ALL" | "DELIVERY" | "DINE_IN">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  // Subscriptions → Take order: the order form opens with that subscriber chosen.
  const [presetCustomer, setPresetCustomer] = useState<TiffinCustomer | null>(null);
  // Change / cancel one delivery order (only while it has not gone out and nothing was collected).
  const [editing, setEditing] = useState<{ order: UnifiedOrder; mode: "edit" | "cancel" } | null>(null);
  const [reassigning, setReassigning] = useState<UnifiedOrder | null>(null);
  const [orderNotice, setOrderNotice] = useTimedMessage<string>();
  // Orders confirmed in the form and still being saved (the form closes at once). A failed save
  // stays here with its reason and a Retry that sends the same order again (same key: recorded once).
  const [pending, setPending] = useState<Array<PendingOrderJob & { status: "saving" | "saved" | "failed"; error?: string; orderId?: string | null }>>([]);
  // The order just added: scrolled into view and lit up for a moment (first as saving, then saved).
  const [flashKey, setFlashKey] = useState<string | null>(null);
  // Its order id once saved: the loaded card that replaces the saving card keeps the light and is
  // brought into view again (the refreshed list can move it).
  const [flashOrderId, setFlashOrderId] = useState<string | null>(null);
  const runPending = useCallback((job: PendingOrderJob) => {
    setPending((list) => [...list.filter((j) => j.key !== job.key), { ...job, status: "saving" as const }]);
    setFlashKey(job.key);
    job
      .run()
      .then(({ message, orderId }) => {
        // Keep the card in place (now "Saved") until the refreshed list contains the order, so
        // nothing disappears and pops back.
        setPending((list) => list.map((j) => (j.key === job.key ? { ...j, status: "saved" as const, orderId } : j)));
        if (orderId) setFlashOrderId(orderId);
        setOrderNotice(message);
        invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
        window.setTimeout(() => setPending((list) => list.filter((j) => j.key !== job.key)), 12000);
      })
      .catch((e: any) => {
        setPending((list) => list.map((j) => (j.key === job.key ? { ...j, status: "failed" as const, error: e?.message || "Could not save the order." } : j)));
        setOrderNotice(`Order for ${job.customerName} was not saved: ${e?.message || "try again"}. Open Today to retry.`);
      });
  }, []);
  useEffect(() => {
    if (!flashKey) return;
    // Once the form has eased out, bring the new order (the last card) into view.
    const s = setTimeout(() => {
      const el = document.querySelector(`[data-pending-key="${flashKey}"]`) || document.querySelector(".rn-order-cards > div:last-of-type");
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 220);
    const t = setTimeout(() => setFlashKey(null), 3200);
    return () => {
      clearTimeout(s);
      clearTimeout(t);
    };
  }, [flashKey]);
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
  const [activeSection, setActiveSection] = useState<"DAILY_ORDERS" | "MENU_CATALOG">("DAILY_ORDERS");
  // Subscriptions → Take order opens /orders?take=<subscription id>: the form opens with that plan.
  const [presetPlanId, setPresetPlanId] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const take = url.searchParams.get("take");
    // The dashboard's "New order" shortcut opens /orders?new=1.
    const fresh = url.searchParams.get("new");
    if (!take && !fresh) return;
    if (take) setPresetPlanId(take);
    setIsNewOrderModalOpen(true);
    url.searchParams.delete("take");
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);


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
    }).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }, [orders, statusFilter, deferredSearch]);

  // Busy days can have hundreds of orders: draw them in pages so opening and filtering stay quick.
  // Search and filters always cover the whole day.
  const PAGE = 60;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [serviceDate, orderTypeFilter, statusFilter, deferredSearch]);
  // A busy day shows its latest orders (where new orders land, in number order); earlier ones open
  // with "Show earlier orders" above the list.
  const visibleOrders = filteredOrders.length > shown ? filteredOrders.slice(filteredOrders.length - shown) : filteredOrders;
  // Each order of the day gets a short number in the order it was taken (#1 is the first), so it
  // can be told apart and called out ("order 12") at a glance.
  const orderNo = useMemo(() => {
    const m = new Map<string, number>();
    [...orders].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((o, i) => m.set(o.id, i + 1));
    return m;
  }, [orders]);
  // A saved order that is now in the list replaces its saving card (same place, same look).
  const loadedIds = useMemo(() => new Set(orders.map((o) => o.orderId)), [orders]);
  const shownPending = pending.filter((j) => !(j.status === "saved" && j.orderId && loadedIds.has(j.orderId)) && j.serviceDate === serviceDate);
  useEffect(() => {
    if (pending.some((j) => j.status === "saved" && j.orderId && loadedIds.has(j.orderId))) {
      setPending((list) => list.filter((j) => !(j.status === "saved" && j.orderId && loadedIds.has(j.orderId))));
    }
  }, [loadedIds, pending]);
  // The card of a just-saved order (now from the list) keeps the highlight briefly.
  const savedFlashIds = useMemo(() => new Set(flashOrderId ? [flashOrderId] : []), [flashOrderId]);
  const flashLoaded = Boolean(flashOrderId && loadedIds.has(flashOrderId));
  // The list can finish loading after the new card was shown (it then moves down): follow it.
  useEffect(() => {
    if (!flashKey) return;
    const s = setTimeout(() => {
      const el = document.querySelector(`[data-pending-key="${flashKey}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length]);
  useEffect(() => {
    if (!flashOrderId || !flashLoaded) return;
    const order = orders.find((o) => o.orderId === flashOrderId);
    const s = setTimeout(() => {
      const el = order ? document.querySelector(`[data-order-id="${order.id}"]`) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 60);
    const t = setTimeout(() => setFlashOrderId(null), 2400);
    return () => {
      clearTimeout(s);
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashOrderId, flashLoaded]);

  // One order as a card (the list on wide screens, the detail sheet on phones).
  const cardFor = (order: UnifiedOrder) => {
    const isDelivery = order.orderType === "DELIVERY";
    const pill = "px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1";
    const status =
      order.orderStatus === "CONFIRMED" ? (
        <span className={`${pill} bg-[#DCE9FA] text-[#163F73] border-[#A9C6EE]`}><Clock className="w-3 h-3" /> Confirmed</span>
      ) : order.orderStatus === "OUT_FOR_DELIVERY" ? (
        <span className={`${pill} bg-[#E0E3FA] text-[#272F7A] border-[#B4BBEE]`}><Truck className="w-3 h-3" /> Out for Delivery</span>
      ) : order.orderStatus === "DELIVERED" && order.deliveryOutcome === "PARTIAL" ? (
        <span className={`${pill} bg-[#FBE9C4] text-[#5E3F04] border-[#EBC777]`}><AlertTriangle className="w-3 h-3" /> Partly delivered</span>
      ) : order.orderStatus === "DELIVERED" ? (
        <span className={`${pill} bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]`}><CheckCircle2 className="w-3 h-3" /> Delivered</span>
      ) : order.orderStatus === "COMPLETED" ? (
        <span className={`${pill} bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]`}><CheckCircle2 className="w-3 h-3" /> {order.paymentStatus === "PAID" ? <>Paid &amp; Complete</> : "Served"}</span>
      ) : order.orderStatus === "EXCEPTION" ? (
        <span className={`${pill} bg-[#FAD9D2] text-[#7A1A0E] border-[#EBA597]`}><AlertTriangle className="w-3 h-3" /> {order.deliveryOutcome === "NONE" ? "Not delivered" : "Shortfall / Issue"}</span>
      ) : order.orderStatus === "CANCELLED" ? (
        <span className={`${pill} bg-[#ECE8E2] text-[#3D3631] border-[#D6CFC5]`}>Cancelled</span>
      ) : null;
    // Money owed stands out: a solid red pill; paid is a calm green.
    const payment =
      order.orderStatus === "CANCELLED" ? null : order.deliveryOutcome === "NONE" ? (
        <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full inline-block bg-[#ECE8E2] text-[#3D3631] border border-[#D6CFC5]">Nothing due</span>
      ) : (
        <span
          className={`text-[12px] font-bold px-2.5 py-1 rounded-full inline-block tabular-nums border ${
            order.paymentStatus === "PAID"
              ? "bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]"
              : order.paymentStatus === "PARTIALLY_PAID"
              ? "bg-[#FBE9C4] text-[#5E3F04] border-[#EBC777]"
              : "bg-[#FDECE8] text-[#A3311D] border-[#F4C3B8]"
          }`}
        >
          {order.paymentStatus === "PAID"
            ? `Paid ₹${order.amountDue ?? order.totalAmount}`
            : order.paymentStatus === "PARTIALLY_PAID"
            ? `Part paid ₹${order.collectedAmount} · ₹${order.remainingAmount} due`
            : `Unpaid ₹${order.remainingAmount}`}
        </span>
      );
    const changeable =
      isDelivery &&
      order.orderStatus !== "CANCELLED" &&
      (order.deliveryStatus === "PENDING" || order.deliveryStatus === "ASSIGNED" || order.deliveryStatus === "OUT_FOR_DELIVERY") &&
      !(order.collectedAmount && order.collectedAmount > 0);
    return (
      <OrderCard
        key={order.id}
        dataAttrs={{ "data-order-id": order.id }}
        highlight={savedFlashIds.has(order.orderId || "")}
        no={orderNo.get(order.id) ?? "–"}
        orderType={order.orderType}
        mealType={order.mealType}
        time={formatDateTime(order.createdAt, undefined, { hour: "2-digit", minute: "2-digit" })}
        customerName={order.customerName}
        customerPhone={order.customerPhone}
        address={order.deliveryAddress}
        driverLabel={
          order.assignedToName
            ? {
                prefix:
                  order.orderStatus === "DELIVERED" || order.orderStatus === "COMPLETED"
                    ? "Delivered by"
                    : order.orderStatus === "EXCEPTION"
                    ? "Attempted by"
                    : order.orderStatus === "OUT_FOR_DELIVERY"
                    ? "Out with"
                    : "Assigned to",
                name: order.assignedToName,
              }
            : null
        }
        edge={
          // Theme colours: forest for done, burnt orange on the way, warm amber waiting.
          order.orderStatus === "CANCELLED"
            ? "#CFC6B8"
            : order.orderStatus === "EXCEPTION"
            ? "#9A3423"
            : order.orderStatus === "DELIVERED" && order.deliveryOutcome === "PARTIAL"
            ? "#C89F6B"
            : order.orderStatus === "DELIVERED" || order.orderStatus === "COMPLETED"
            ? "#5D7656"
            : order.orderStatus === "OUT_FOR_DELIVERY"
            ? "#B4461A"
            : "#E8A57A"
        }
        status={status}
        payment={payment}
        items={order.items.map((it) => ({ quantity: it.quantity, name: it.productName, lineTotal: it.lineTotal }))}
        total={order.totalAmount}
        note={
          <>
            {(order.revision ?? 0) > 0 && <span className="text-[11.5px] text-[var(--rn-ink-3)]">Edited</span>}
            {order.orderStatus === "CANCELLED" && order.cancelReason && <span className="text-[12px] text-[#A3261A] truncate">Cancelled: {order.cancelReason}</span>}
          </>
        }
        actions={
          <>
            {changeable && (
              <>
                <button type="button" onClick={() => setEditing({ order, mode: "edit" })} className="h-9 px-3.5 rounded-full text-[13px] font-semibold text-[var(--rn-ink)] hover:bg-[var(--rn-accent-tint)]">
                  Change
                </button>
                <button type="button" onClick={() => setEditing({ order, mode: "cancel" })} className="h-9 px-3.5 rounded-full text-[13px] font-semibold text-[#A3261A] hover:bg-[#FBEDE8]">
                  Cancel order
                </button>
              </>
            )}
            {isDelivery && order.deliveryTaskId && order.orderStatus !== "CANCELLED" && order.deliveryStatus !== "DELIVERED" && order.deliveryStatus !== "CANCELLED" && (
              <button type="button" onClick={() => setReassigning(order)} className="h-9 px-3.5 rounded-full text-[13px] font-semibold text-[var(--rn-ink)] hover:bg-[var(--rn-accent-tint)]">
                Assign to
              </button>
            )}
            {isDelivery && (
              <Link
                href={`/delivery?tab=board&date=${order.serviceDate}&meal=${order.mealType}`}
                className="ml-1 inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-[var(--rn-accent)] text-[13px] font-semibold text-[var(--rn-accent)] hover:bg-[var(--rn-accent)] hover:text-white transition-colors"
              >
                View delivery <span aria-hidden>&rarr;</span>
              </Link>
            )}
          </>
        }
      />
    );
  };
  const pendingCardFor = (j: (typeof shownPending)[number], i: number) => {
    const failed = j.status === "failed";
    const saved = j.status === "saved";
    const pill = "px-2.5 py-1 rounded-full text-[12px] font-semibold border inline-flex items-center gap-1.5";
    return (
      <OrderCard
        key={j.key}
        dataAttrs={{ "data-pending-key": j.key }}
        ariaLabel={failed ? `Order for ${j.customerName} not saved` : saved ? `Order for ${j.customerName} saved` : `Order for ${j.customerName} being saved`}
        tone={failed ? "failed" : "normal"}
        highlight={flashKey === j.key}
        no={orders.length + i + 1}
        orderType={j.orderType}
        mealType={j.mealType}
        time={formatDateTime(j.createdAt, undefined, { hour: "2-digit", minute: "2-digit" })}
        customerName={j.customerName}
        customerPhone={j.customerPhone}
        address={j.deliveryAddress}
        driverLabel={undefined}
        edge={failed ? "#9A3423" : "#E8A57A"}
        status={
          failed ? (
            <span className={`${pill} bg-[#FAD9D2] text-[#7A1A0E] border-[#EBA597]`}><AlertTriangle className="w-3 h-3" /> Not saved</span>
          ) : saved ? (
            <span className={`${pill} bg-[#D8EFD2] text-[#1D4E16] border-[#A3D396]`}><CheckCircle2 className="w-3 h-3" /> Saved</span>
          ) : (
            <span className={`${pill} bg-[#DCE9FA] text-[#163F73] border-[#A9C6EE]`}><span className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden /> Saving</span>
          )
        }
        items={j.items.map((it) => ({ quantity: it.quantity, name: it.name, lineTotal: it.lineTotal }))}
        total={j.total}
        note={failed ? <span className="text-[12px] text-[#8A1F12] truncate max-w-[280px]" title={j.error}>{j.error}</span> : undefined}
        actions={
          failed ? (
            <>
              <button type="button" onClick={() => setPending((list) => list.filter((x) => x.key !== j.key))} className="h-9 px-3.5 rounded-full text-[13px] font-semibold text-[var(--rn-ink-2)] hover:bg-white/70">
                Dismiss
              </button>
              <button type="button" onClick={() => runPending(j)} className="h-9 px-4 rounded-full bg-[var(--rn-accent)] text-white text-[13px] font-semibold">
                Retry
              </button>
            </>
          ) : undefined
        }
      />
    );
  };

  const mobile = (
    <OrdersMobile
      section={activeSection}
      setSection={setActiveSection}
      counts={counts}
      serviceDate={serviceDate}
      setServiceDate={setServiceDate}
      orderType={orderTypeFilter}
      setOrderType={setOrderTypeFilter}
      status={statusFilter}
      setStatus={setStatusFilter}
      search={searchQuery}
      setSearch={setSearchQuery}
      loading={isLoading}
      orders={visibleOrders}
      allCount={filteredOrders.length}
      onEarlier={() => setShown((n) => n + PAGE)}
      orderNo={orderNo}
      pending={shownPending}
      cardFor={cardFor}
      pendingCardFor={pendingCardFor}
      onNewOrder={() => setIsNewOrderModalOpen(true)}
      notice={orderNotice}
      menu={activeSection === "MENU_CATALOG" ? <MenuCatalog /> : null}
    />
  );

  const desktop = (
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
            <div className="flex items-center gap-2 flex-wrap rn-filter-row">
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

          {/* ORDER CARDS LIST */}
          {isLoading ? (
            <BikeLoader label="Loading orders" className="py-12" />
          ) : filteredOrders.length === 0 && shownPending.length === 0 ? (
            <EmptyState title="No orders for this date" />
          ) : (
            <>
            {filteredOrders.length > visibleOrders.length && (
              <div className="px-4 pt-4 flex items-center justify-center gap-3">
                <span className="text-[12.5px] text-[var(--rn-ink-3)] tabular-nums">{visibleOrders.length}/{filteredOrders.length}</span>
                <button type="button" className="rn-btn" onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, filteredOrders.length - visibleOrders.length)} earlier orders
                </button>
              </div>
            )}
            <div className="rn-order-cards p-3 sm:p-4 space-y-3">
              {visibleOrders.map(cardFor)}
              {shownPending.map(pendingCardFor)}
            </div>
            </>
          )}
        </div>
      )}

      {/* Menu: the real catalogue and current prices */}
      {activeSection === "MENU_CATALOG" && (
        <div className="rn-card p-4 sm:p-6">
          <MenuCatalog />
        </div>
      )}

    </div>
  );

  return (
    <div className="min-w-0">
      <PhoneOrDesktop phone={phone} mobile={mobile} desktop={desktop} />
      {reassigning && <ReassignDialog order={reassigning as any} onClose={() => setReassigning(null)} />}
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
      {orderNotice && phone === false && (
        <div role="status" className="fixed bottom-6 left-4 z-40 px-4 py-2.5 rounded-xl bg-[#1A2E20] text-white text-sm shadow-lg">{orderNotice}</div>
      )}

      {/* Fast Order Entry Modal */}
      <NewOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => {
          setIsNewOrderModalOpen(false);
          setPresetCustomer(null);
          setPresetPlanId(null);
        }}
        presetCustomer={presetCustomer}
        presetPlanId={presetPlanId}
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
