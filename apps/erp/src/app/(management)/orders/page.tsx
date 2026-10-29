"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { UnifiedOrder, AuthenticatedUser } from "@/types";
import { NewOrderModal } from "@/modules/orders/components/NewOrderModal";
import Link from "next/link";

export default function OrdersPage() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [counts, setCounts] = useState<{ today: number; active: number; completed: number }>({
    today: 0,
    active: 0,
    completed: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [serviceDate, setServiceDate] = useState(new Date().toISOString().split("T")[0]);
  const [orderTypeFilter, setOrderTypeFilter] = useState<"ALL" | "DELIVERY" | "DINE_IN">("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"DAILY_ORDERS" | "SUBSCRIPTIONS" | "MENU_CATALOG">("DAILY_ORDERS");

  // Load current user
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setCurrentUser(data.user);
      })
      .catch(() => {});
  }, []);

  // Fetch orders from real backend
  const fetchOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        serviceDate,
        orderType: orderTypeFilter,
      });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const res = await fetch(`/api/orders?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load orders");
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        if (data.counts) setCounts(data.counts);
      }
    } catch {
      // Graceful error handling
    } finally {
      setIsLoading(false);
    }
  }, [serviceDate, orderTypeFilter, statusFilter, searchQuery]);

  // Initial load
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Live polling without manual refresh (every 4s when tab is active)
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchOrders();
      }
    }, 4000);

    const handleFocus = () => fetchOrders();
    const handleCustomEvent = () => fetchOrders();

    window.addEventListener("focus", handleFocus);
    window.addEventListener("erp:order_created", handleCustomEvent);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("erp:order_created", handleCustomEvent);
    };
  }, [fetchOrders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
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
  }, [orders, statusFilter]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E6E1DA] pb-5">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#8E9F89] block">
            Commercial PG &amp; Tiffin Services
          </span>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl sm:text-3xl text-[#1A2E20] font-bold">Orders</h1>
            {/* Real data compact badges */}
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="px-2.5 py-0.5 rounded-full bg-[#1A2E20]/5 text-[#1A2E20] border border-[#1A2E20]/15">
                Today: <strong>{counts.today}</strong>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                Active: <strong>{counts.active}</strong>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                Done: <strong>{counts.completed}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Action button & secondary section tabs */}
        <div className="flex items-center gap-2">
          {/* Section view toggle */}
          <div className="flex bg-white p-1 rounded-2xl border border-[#E6E1DA] shadow-2xs">
            <button
              onClick={() => setActiveSection("DAILY_ORDERS")}
              className={`px-3 py-1.5 text-xs font-serif rounded-xl transition ${
                activeSection === "DAILY_ORDERS"
                  ? "bg-[#1A2E20] text-white font-medium shadow-xs"
                  : "text-[#5D7656] hover:text-[#1A2E20]"
              }`}
            >
              Daily Orders
            </button>
            <button
              onClick={() => setActiveSection("SUBSCRIPTIONS")}
              className={`px-3 py-1.5 text-xs font-serif rounded-xl transition ${
                activeSection === "SUBSCRIPTIONS"
                  ? "bg-[#1A2E20] text-white font-medium shadow-xs"
                  : "text-[#5D7656] hover:text-[#1A2E20]"
              }`}
            >
              Subscriptions
            </button>
            <button
              onClick={() => setActiveSection("MENU_CATALOG")}
              className={`px-3 py-1.5 text-xs font-serif rounded-xl transition ${
                activeSection === "MENU_CATALOG"
                  ? "bg-[#1A2E20] text-white font-medium shadow-xs"
                  : "text-[#5D7656] hover:text-[#1A2E20]"
              }`}
            >
              Menu Catalog
            </button>
          </div>

          <button
            onClick={() => setIsNewOrderModalOpen(true)}
            className="px-5 py-2.5 bg-[#C89F6B] hover:bg-[#B58A57] text-[#1A2E20] font-serif font-bold text-xs rounded-2xl shadow-sm transition flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" />
            + New Order
          </button>
        </div>
      </div>

      {activeSection === "DAILY_ORDERS" && (
        <div className="space-y-4">
          {/* SEARCH & FILTERS BAR */}
          <div className="bg-white p-3.5 rounded-2xl border border-[#E6E1DA] shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8E9F89]" />
              <input
                type="text"
                placeholder="Search by customer name, phone, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto shrink-0 flex-wrap">
              {/* Date selector */}
              <input
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              />

              {/* Order Type Filter */}
              <select
                value={orderTypeFilter}
                onChange={(e) => setOrderTypeFilter(e.target.value as any)}
                className="px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              >
                <option value="ALL">All Orders</option>
                <option value="DELIVERY">Delivery Only</option>
                <option value="DINE_IN">Dine In Only</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active (In Flight)</option>
                <option value="COMPLETED">Completed</option>
              </select>

              <button
                onClick={fetchOrders}
                disabled={isLoading}
                title="Refresh order list"
                className="p-2 text-[#5D7656] hover:text-[#1A2E20] bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* ORDER CARDS LIST */}
          {isLoading ? (
            <div className="p-12 text-center text-xs font-serif text-[#8E9F89]">
              Loading live orders...
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 bg-white rounded-3xl border border-[#E6E1DA] text-center space-y-3">
              <ShoppingBag className="w-10 h-10 text-[#C89F6B] mx-auto opacity-40" />
              <h3 className="font-serif text-lg text-[#1A2E20]">No Orders for this Date</h3>
              <p className="text-xs text-[#8E9F89] max-w-sm mx-auto">
                No orders match your current filters. Click "+ New Order" above to take a fast delivery or dine-in order.
              </p>
              <button
                onClick={() => setIsNewOrderModalOpen(true)}
                className="px-4 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Take New Order
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => {
                const isDelivery = order.orderType === "DELIVERY";
                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl border border-[#E6E1DA] p-4 sm:p-5 shadow-2xs hover:border-[#DCD6CD] transition space-y-3"
                  >
                    {/* Top Row: Customer, Type Badge & Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {/* Icon badge */}
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            isDelivery ? "bg-[#1A2E20] text-[#C89F6B]" : "bg-[#B58A57]/20 text-[#8B6538]"
                          }`}
                        >
                          {isDelivery ? <Truck className="w-5 h-5" /> : <Utensils className="w-5 h-5" />}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
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
                              {new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>

                          <h3 className="font-serif text-base text-[#1A2E20] font-semibold mt-0.5">
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
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-blue-50 text-blue-800 border border-blue-200 inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Confirmed
                            </span>
                          )}
                          {order.orderStatus === "OUT_FOR_DELIVERY" && (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-indigo-50 text-indigo-800 border border-indigo-200 inline-flex items-center gap-1">
                              <Truck className="w-3 h-3 animate-pulse" /> Out for Delivery
                            </span>
                          )}
                          {order.orderStatus === "DELIVERED" && (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Delivered
                            </span>
                          )}
                          {order.orderStatus === "COMPLETED" && (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Paid &amp; Complete
                            </span>
                          )}
                          {order.orderStatus === "EXCEPTION" && (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-red-50 text-red-800 border border-red-200 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Shortfall / Issue
                            </span>
                          )}
                        </div>

                        {/* Payment badge */}
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded inline-block ${
                            order.paymentStatus === "PAID"
                              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                              : order.paymentStatus === "PARTIALLY_PAID"
                              ? "bg-amber-50 text-amber-800 border border-amber-200"
                              : "bg-red-50 text-red-800 border border-red-200"
                          }`}
                        >
                          {order.paymentStatus === "PAID"
                            ? `PAID (₹${order.totalAmount})`
                            : order.paymentStatus === "PARTIALLY_PAID"
                            ? `PARTIAL (₹${order.collectedAmount} / ₹${order.totalAmount})`
                            : `UNPAID DUE ₹${order.remainingAmount}`}
                        </span>
                      </div>
                    </div>

                    {/* Delivery Address (if Delivery) */}
                    {isDelivery && order.deliveryAddress && (
                      <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
                        <span className="text-[#1A2E20] font-medium">{order.deliveryAddress}</span>
                        {order.assignedToName && (
                          <span className="text-[#8E9F89] font-serif ml-auto shrink-0">
                            Driver: <strong>{order.assignedToName}</strong>
                          </span>
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
                        {isDelivery && (
                          <Link
                            href="/delivery"
                            className="inline-flex items-center gap-1 text-[11px] font-serif text-[#C89F6B] hover:text-[#B58A57] font-medium"
                          >
                            View Delivery &rarr;
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECONDARY VIEW: SUBSCRIPTIONS */}
      {activeSection === "SUBSCRIPTIONS" && (
        <div className="bg-white p-6 rounded-3xl border border-[#E6E1DA] space-y-4">
          <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
            <div>
              <h2 className="font-serif text-lg text-[#1A2E20] font-bold">Monthly Tiffin Subscriptions</h2>
              <p className="text-xs text-[#8E9F89]">
                Commercial repeat meal plan subscriptions with automated daily kitchen counts.
              </p>
            </div>
            <Link
              href="/delivery"
              className="text-xs font-serif text-[#B58A57] hover:underline"
            >
              Go to Delivery Queue &rarr;
            </Link>
          </div>

          <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-[#E6E1DA] text-xs space-y-2">
            <p className="font-serif font-medium text-[#1A2E20]">
              Active Subscriptions are automatically integrated into daily kitchen preparation and the delivery dispatch board.
            </p>
            <p className="text-[#8E9F89]">
              To create or pause customer meal subscriptions, select an existing customer when taking an order or manage via the customer directory.
            </p>
          </div>
        </div>
      )}

      {/* SECONDARY VIEW: MENU CATALOG */}
      {activeSection === "MENU_CATALOG" && (
        <div className="bg-white p-6 rounded-3xl border border-[#E6E1DA] space-y-4">
          <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
            <div>
              <h2 className="font-serif text-lg text-[#1A2E20] font-bold">Menu &amp; Pricing Catalog</h2>
              <p className="text-xs text-[#8E9F89]">
                Menu offerings and base unit pricing used for order calculation.
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#FAF8F5] rounded-2xl border border-[#E6E1DA] text-xs space-y-2">
            <p className="font-serif font-medium text-[#1A2E20]">
              Historical Price Invariance Guard:
            </p>
            <p className="text-[#8E9F89]">
              All confirmed orders snapshot their menu unit prices at time of creation. Modifying catalog prices will never rewrite existing orders or historical delivery balances.
            </p>
          </div>
        </div>
      )}

      {/* Fast Order Entry Modal */}
      <NewOrderModal
        isOpen={isNewOrderModalOpen}
        onClose={() => setIsNewOrderModalOpen(false)}
        onOrderCreated={fetchOrders}
        defaultDate={serviceDate}
      />
    </div>
  );
}
