"use client";

/**
 * Orders on the phone app: today's figures, one-tap New order, a compact list (one line per order)
 * and the full order card in a sheet when an order is tapped. Built on the app kit.
 */

import React, { useState } from "react";
import Link from "next/link";
import { Plus, ShoppingBag, CalendarDays, Pencil, Phone, MapPin, Bike, XCircle, UserRoundCog, Truck } from "lucide-react";
import type { UnifiedOrder } from "@/types";
import { formatMoney } from "@/lib/format";
import { MButton, MEmpty, MField, MGroup, MHero, MNotice, MPill, MRow, MSearch, MSegment, MSheet, MSkeletonRows, MStack, dayLabel, type MTone } from "@/components/app/m";

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

/** A delivery order can be changed or cancelled while it has not been delivered and nothing was collected. */
const changeable = (o: UnifiedOrder) =>
  o.orderType === "DELIVERY" && o.orderStatus !== "CANCELLED" && (o.deliveryStatus === "PENDING" || o.deliveryStatus === "ASSIGNED" || o.deliveryStatus === "OUT_FOR_DELIVERY") && !(o.collectedAmount && o.collectedAmount > 0);
const reassignable = (o: UnifiedOrder) => o.orderType === "DELIVERY" && Boolean(o.deliveryTaskId) && o.orderStatus !== "CANCELLED" && o.deliveryStatus !== "DELIVERED" && o.deliveryStatus !== "CANCELLED";
const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));

/** One order, laid out to read at a glance: status and money, who and where, what, then actions. */
function OrderDetail({ o, onCancel, onReassign }: { o: UnifiedOrder; onCancel?: () => void; onReassign?: () => void }) {
  const st = statusOf(o);
  const due = o.orderStatus !== "CANCELLED" && o.paymentStatus !== "PAID" && o.deliveryOutcome !== "NONE" ? o.remainingAmount ?? o.totalAmount : 0;
  return (
    <>
      <div className="m-card px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[17px] font-semibold text-[var(--m-ink)] truncate">{o.customerName}</p>
            <p className="mt-0.5 text-[13.5px] text-[var(--m-ink-2)]">
              {o.orderType === "DINE_IN" ? "Dine in" : "Delivery"} · {meal(o.mealType)} · {time(o.createdAt)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[22px] font-semibold tabular-nums leading-none text-[var(--m-ink)]">{formatMoney(o.totalAmount)}</p>
            <p className={`mt-1 text-[12.5px] font-semibold ${due > 0 ? "m-text-red" : "m-text-green"}`}>
              {o.orderStatus === "CANCELLED" ? "" : o.deliveryOutcome === "NONE" ? "Nothing due" : due > 0 ? (o.paymentStatus === "PARTIALLY_PAID" ? `${formatMoney(due)} due` : "Unpaid") : "Paid"}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <MPill tone={st.tone}>{st.label}</MPill>
          {(o.revision ?? 0) > 0 && <MPill tone="neutral">Edited</MPill>}
        </div>
      </div>

      <div className="m-card py-1">
        {o.customerPhone && (
          <MField label="Phone">
            <a href={`tel:${o.customerPhone}`} className="inline-flex items-center gap-1.5 text-[var(--rn-accent)] tabular-nums">
              <Phone className="w-4 h-4" /> {o.customerPhone}
            </a>
          </MField>
        )}
        {o.orderType === "DELIVERY" && o.deliveryAddress && (
          <MField label="Deliver to">
            <span className="inline-flex items-start gap-1.5 text-right">
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" /> {o.deliveryAddress}
            </span>
          </MField>
        )}
        {o.orderType === "DELIVERY" && (
          <MField label="Delivery">
            <span className="inline-flex items-center gap-1.5">
              <Bike className="w-4 h-4" /> {o.assignedToName || "Not assigned"}
            </span>
          </MField>
        )}
        {o.notes && <MField label="Note">{o.notes}</MField>}
        {o.orderStatus === "CANCELLED" && o.cancelReason && <MField label="Cancelled">{o.cancelReason}</MField>}
      </div>

      <div className="m-card py-1" aria-label="Items">
        {o.items.map((it, i) => (
          <MField key={i} label={`${it.quantity} × ${it.productName}`}>
            <span className="tabular-nums">{formatMoney(it.lineTotal)}</span>
          </MField>
        ))}
        <MField label={<span className="font-semibold text-[var(--m-ink)]">Total</span>}>
          <span className="tabular-nums font-semibold">{formatMoney(o.totalAmount)}</span>
        </MField>
      </div>

      {(onReassign || onCancel) && (
        <MGroup>
          {onReassign && <MRow icon={UserRoundCog} tone="blue" title="Assign to someone else" sub={o.assignedToName ? `Now with ${o.assignedToName}` : undefined} onClick={onReassign} />}
          {onCancel && <MRow icon={XCircle} tone="red" title="Cancel order" onClick={onCancel} />}
        </MGroup>
      )}
    </>
  );
}

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
  onEdit,
  onCancel,
  onReassign,
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
  onEdit: (o: UnifiedOrder) => void;
  onCancel: (o: UnifiedOrder) => void;
  onReassign: (o: UnifiedOrder) => void;
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
                    className={`rn-pending-row ${p.status === "saving" ? "is-saving" : ""}`}
                  />
                ))}
              </MGroup>
            </>
          )}
        </>
      )}

      <MSheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open ? `Order #${orderNo.get(open.id) ?? ""}` : ""}
        headerAction={
          open && changeable(open) ? (
            <button
              type="button"
              aria-label="Edit order"
              className="m-sheet-x m-press"
              onClick={() => {
                const o = open;
                setOpenId(null);
                onEdit(o);
              }}
            >
              <Pencil className="w-[18px] h-[18px]" />
            </button>
          ) : undefined
        }
        footer={
          open && open.orderType === "DELIVERY" && open.orderStatus !== "CANCELLED" ? (
            <Link href={`/delivery?tab=board&date=${open.serviceDate}&meal=${open.mealType}`} className="m-btn m-btn-soft m-press w-full" onClick={() => setOpenId(null)}>
              <Truck className="w-[18px] h-[18px]" /> View delivery
            </Link>
          ) : undefined
        }
      >
        {open && (
          <OrderDetail
            o={open}
            onCancel={changeable(open) ? () => (setOpenId(null), onCancel(open)) : undefined}
            onReassign={reassignable(open) ? () => (setOpenId(null), onReassign(open)) : undefined}
          />
        )}
      </MSheet>
      <MSheet open={pIndex >= 0} onClose={() => setOpenPending(null)} title={pIndex >= 0 ? pending[pIndex].customerName : ""}>
        {pIndex >= 0 && <div className="m-order-sheet">{pendingCardFor(pending[pIndex], pIndex)}</div>}
      </MSheet>
    </MStack>
  );
}
