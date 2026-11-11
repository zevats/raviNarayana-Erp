"use client";

/**
 * Orders on the phone app: today's figures, one-tap New order, a compact list (one line per order)
 * and the full order card in a sheet when an order is tapped. Built on the app kit.
 */

import React, { useState } from "react";
import { Plus, ShoppingBag, CalendarDays } from "lucide-react";
import type { UnifiedOrder } from "@/types";
import { formatMoney } from "@/lib/format";
import { MButton, MEmpty, MGroup, MHero, MNotice, MRow, MSearch, MSegment, MSheet, MSkeletonRows, MStack, dayLabel, type MTone } from "@/components/app/m";

type Pending = { key: string; customerName: string; orderType: string; mealType: string; total: number; status: "saving" | "saved" | "failed" };

function statusOf(o: UnifiedOrder): { label: string; tone: MTone } {
  if (o.orderStatus === "CANCELLED") return { label: "Cancelled", tone: "neutral" };
  if (o.orderStatus === "EXCEPTION") return { label: o.deliveryOutcome === "NONE" ? "Not delivered" : "Issue", tone: "red" };
  if (o.orderStatus === "OUT_FOR_DELIVERY") return { label: "On the way", tone: "orange" };
  if (o.orderStatus === "DELIVERED") return { label: o.deliveryOutcome === "PARTIAL" ? "Part delivered" : "Delivered", tone: o.deliveryOutcome === "PARTIAL" ? "amber" : "green" };
  if (o.orderStatus === "COMPLETED") return { label: "Served", tone: "green" };
  return { label: "Confirmed", tone: "blue" };
}
const meal = (m: string) => (m ? m.charAt(0) + m.slice(1).toLowerCase() : "");

export function OrdersMobile({
  section,
  setSection,
  counts,
  serviceDate,
  setServiceDate,
  orderType,
  setOrderType,
  status,
  setStatus,
  search,
  setSearch,
  loading,
  orders,
  allCount,
  onEarlier,
  orderNo,
  pending,
  cardFor,
  pendingCardFor,
  onNewOrder,
  notice,
  menu,
}: {
  section: "DAILY_ORDERS" | "MENU_CATALOG";
  setSection: (s: "DAILY_ORDERS" | "MENU_CATALOG") => void;
  counts: { today: number; active: number; completed: number };
  serviceDate: string;
  setServiceDate: (d: string) => void;
  orderType: "ALL" | "DELIVERY" | "DINE_IN";
  setOrderType: (t: "ALL" | "DELIVERY" | "DINE_IN") => void;
  status: string;
  setStatus: (s: string) => void;
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
  orders: UnifiedOrder[];
  allCount: number;
  onEarlier: () => void;
  orderNo: Map<string, number>;
  pending: Pending[];
  cardFor: (o: UnifiedOrder) => React.ReactNode;
  pendingCardFor: (j: any, i: number) => React.ReactNode;
  onNewOrder: () => void;
  notice: string | null;
  menu: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [openPending, setOpenPending] = useState<string | null>(null);
  const open = openId ? orders.find((o) => o.id === openId) ?? null : null;
  const pIndex = openPending ? pending.findIndex((p) => p.key === openPending) : -1;
  const toCollect = orders.reduce((s, o) => (o.orderStatus !== "CANCELLED" && o.paymentStatus !== "PAID" && o.deliveryOutcome !== "NONE" ? s + (o.remainingAmount ?? 0) : s), 0);

  return (
    <MStack>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 items-center">
        <MSegment
          label="Orders sections"
          value={section}
          onChange={setSection}
          options={[
            { value: "DAILY_ORDERS", label: "Orders", count: counts.today },
            { value: "MENU_CATALOG", label: "Menu" },
          ]}
        />
        <MButton kind="primary" icon={Plus} onClick={onNewOrder} className="!px-4">
          New order
        </MButton>
      </div>

      {notice && <MNotice>{notice}</MNotice>}

      {section === "MENU_CATALOG" ? (
        <div className="m-card">{menu}</div>
      ) : (
        <>
          <MHero
            tone="orange"
            label={<>Orders · {dayLabel(serviceDate)}</>}
            value={counts.today}
            items={[
              { label: "In progress", value: counts.active, onClick: () => setStatus("ACTIVE") },
              { label: "Done", value: counts.completed, onClick: () => setStatus("COMPLETED") },
              { label: "To collect", value: formatMoney(toCollect) },
            ]}
          />
          <div className="flex items-center gap-2.5 min-w-0">
            <label className="m-search m-date-pill">
              <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} aria-label="Day" />
            </label>
            <div className="flex-1 min-w-0">
              <MSegment
                label="Order type"
                value={orderType}
                onChange={setOrderType}
                options={[
                  { value: "ALL", label: "All" },
                  { value: "DELIVERY", label: "Delivery" },
                  { value: "DINE_IN", label: "Dine in" },
                ]}
              />
            </div>
          </div>
          {status !== "ALL" && (
            <div className="m-chips">
              <button type="button" role="radio" aria-checked="true" onClick={() => setStatus("ALL")} className="m-chip m-press">
                {status === "ACTIVE" ? "In progress" : "Done"} ✕
              </button>
            </div>
          )}
          <MSearch value={search} onChange={setSearch} placeholder="Search name, phone or address" />

          {loading ? (
            <MSkeletonRows rows={6} />
          ) : orders.length === 0 && pending.length === 0 ? (
            <MEmpty icon={ShoppingBag} title="No orders for this day" />
          ) : (
            <>
              {allCount > orders.length && (
                <button type="button" onClick={onEarlier} className="m-more m-press">
                  Show earlier orders
                </button>
              )}
              <MGroup>
                {orders.map((o) => {
                  const st = statusOf(o);
                  const unpaid = o.orderStatus !== "CANCELLED" && o.paymentStatus !== "PAID" && o.deliveryOutcome !== "NONE";
                  const itemsText = o.items.length === 1 ? `${o.items[0].quantity}× ${o.items[0].productName}` : `${o.items.reduce((n, it) => n + it.quantity, 0)} items`;
                  return (
                    <MRow
                      key={o.id}
                      avatar={`#${orderNo.get(o.id) ?? "–"}`}
                      tone={st.tone}
                      title={o.customerName}
                      sub={[o.orderType === "DINE_IN" ? "Dine in" : "Delivery", meal(o.mealType), itemsText].filter(Boolean).join(" · ")}
                      right={formatMoney(o.totalAmount)}
                      rightSub={<span className={`m-text-${unpaid ? "red" : st.tone}`}>{unpaid ? (o.paymentStatus === "PARTIALLY_PAID" ? "Part paid" : "Unpaid") : st.label}</span>}
                      strike={o.orderStatus === "CANCELLED"}
                      onClick={() => setOpenId(o.id)}
                      chevron={false}
                    />
                  );
                })}
                {pending.map((p) => (
                  <MRow
                    key={p.key}
                    avatar="…"
                    tone={p.status === "failed" ? "red" : p.status === "saved" ? "green" : "blue"}
                    title={p.customerName}
                    sub={[p.orderType === "DINE_IN" ? "Dine in" : "Delivery", meal(p.mealType)].join(" · ")}
                    right={formatMoney(p.total)}
                    rightSub={<span className={p.status === "failed" ? "m-text-red" : p.status === "saved" ? "m-text-green" : "m-text-blue"}>{p.status === "failed" ? "Not saved" : p.status === "saved" ? "Saved" : "Saving…"}</span>}
                    onClick={() => setOpenPending(p.key)}
                    chevron={false}
                  />
                ))}
              </MGroup>
            </>
          )}
        </>
      )}

      <MSheet open={Boolean(open)} onClose={() => setOpenId(null)} title={open ? `Order #${orderNo.get(open.id) ?? ""}` : ""} tall>
        {open && <div className="m-order-sheet">{cardFor(open)}</div>}
      </MSheet>
      <MSheet open={pIndex >= 0} onClose={() => setOpenPending(null)} title={pIndex >= 0 ? pending[pIndex].customerName : ""}>
        {pIndex >= 0 && <div className="m-order-sheet">{pendingCardFor(pending[pIndex], pIndex)}</div>}
      </MSheet>
    </MStack>
  );
}
