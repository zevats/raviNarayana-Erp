"use client";

import React from "react";
import { Truck, Utensils, MapPin, Phone, Bike, Clock } from "lucide-react";

/**
 * One order on Orders → Today, used for saved orders and for an order still being saved, so both
 * look the same and a saving card turns into the saved one in place. Colours come from the
 * section theme (--rn-*); the status label shows the state, the number identifies it.
 */
export interface OrderCardProps {
  no: number | string;
  orderType: "DELIVERY" | "DINE_IN" | string;
  mealType: string;
  time: string;
  customerName: string;
  customerPhone?: string | null;
  address?: string | null;
  /** "Out with Suresh" etc.; null when nobody is assigned yet (delivery). */
  driverLabel?: { prefix: string; name: string } | null;
  /** Kept for callers; the card no longer draws a coloured edge (its status label says it). */
  edge?: string;
  status: React.ReactNode;
  payment?: React.ReactNode;
  items: Array<{ quantity: number; name: string; lineTotal: number }>;
  total: number;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  highlight?: boolean;
  tone?: "normal" | "failed";
  dataAttrs?: Record<string, string>;
  ariaLabel?: string;
}

const rupees = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const titleCase = (s: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : s);

export function OrderCard(p: OrderCardProps) {
  const isDelivery = p.orderType === "DELIVERY";
  return (
    <div
      {...(p.dataAttrs || {})}
      aria-label={p.ariaLabel}
      className={`group relative overflow-hidden rounded-[22px] border transition-[background-color,box-shadow] duration-500 ${
        p.tone === "failed" ? "bg-[#FFF6F4] border-[#F2C2B8]" : p.highlight ? "bg-[var(--rn-accent-tint)] border-[var(--rn-accent-soft)]" : "bg-white border-[var(--rn-line)]"
      } shadow-[0_1px_2px_rgba(40,20,10,0.05),0_12px_28px_-22px_rgba(40,20,10,0.45)] hover:shadow-[0_1px_2px_rgba(40,20,10,0.06),0_18px_36px_-22px_rgba(40,20,10,0.5)]`}
    >
      <div className="px-5 pt-4 pb-3.5 sm:px-6">
        {/* Who and what */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex items-start gap-3 min-w-0">
            <span className="mt-0.5 shrink-0 min-w-[42px] h-[42px] px-1.5 rounded-[14px] bg-[var(--rn-accent-tint)] border border-[var(--rn-accent-soft)] text-[var(--rn-accent)] flex flex-col items-center justify-center leading-none">
              <span className="text-[15px] font-extrabold tabular-nums">#{p.no}</span>
            </span>
            <div className="min-w-0">
              <h3 className="text-[17px] leading-snug font-bold text-[var(--rn-ink)] truncate">{p.customerName}</h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-[var(--rn-ink-2)]">
                <span className="inline-flex items-center gap-1 font-semibold text-[var(--rn-ink)]">
                  {isDelivery ? <Truck className="w-3.5 h-3.5 text-[var(--rn-accent)]" /> : <Utensils className="w-3.5 h-3.5 text-[var(--rn-accent)]" />}
                  {isDelivery ? "Delivery" : "Dine in"}
                </span>
                <span aria-hidden className="w-1 h-1 rounded-full bg-[#CFC6BC]" />
                <span>{titleCase(p.mealType)}</span>
                <span aria-hidden className="w-1 h-1 rounded-full bg-[#CFC6BC]" />
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Clock className="w-3 h-3 opacity-70" />
                  {p.time}
                </span>
                {p.customerPhone && (
                  <>
                    <span aria-hidden className="w-1 h-1 rounded-full bg-[#CFC6BC]" />
                    <a href={`tel:${p.customerPhone}`} className="inline-flex items-center gap-1 tabular-nums hover:text-[var(--rn-accent)]">
                      <Phone className="w-3 h-3 opacity-70" />
                      {p.customerPhone}
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 ml-auto">
            {p.status}
            {p.payment}
          </div>
        </div>

        {/* Where and who is taking it */}
        {isDelivery && (p.address || p.driverLabel !== undefined) && (
          <div className="mt-3.5 grid gap-px overflow-hidden rounded-2xl border border-[var(--rn-line)] bg-[var(--rn-line)] sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)]">
            <div className="bg-[#FCFAF7] px-3.5 py-2.5 min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--rn-ink-3)]">Deliver to</p>
              <p className="mt-0.5 flex items-start gap-1.5 text-[13.5px] font-medium text-[var(--rn-ink)]">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--rn-accent)]" />
                <span className="min-w-0 break-words">{p.address || "—"}</span>
              </p>
            </div>
            <div className="bg-[#FCFAF7] px-3.5 py-2.5 sm:min-w-[200px]">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[var(--rn-ink-3)]">Delivery</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13.5px] text-[var(--rn-ink-2)]">
                <Bike className="w-3.5 h-3.5 shrink-0 text-[var(--rn-accent)]" />
                {p.driverLabel ? (
                  <span>
                    {p.driverLabel.prefix} <strong className="font-semibold text-[var(--rn-ink)]">{p.driverLabel.name}</strong>
                  </span>
                ) : p.driverLabel === undefined ? (
                  <span className="text-[var(--rn-ink-3)]">Assigning…</span>
                ) : (
                  <span className="font-semibold text-[#8F5A06]">Not assigned yet</span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* Items */}
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Items">
          {p.items.map((it, i) => (
            <li key={i} className="inline-flex items-center gap-1.5 rounded-full bg-[#F6F1EB] px-3 py-1 text-[12.5px] text-[var(--rn-ink)]">
              <span className="font-bold tabular-nums">{it.quantity}×</span>
              <span>{it.name}</span>
              <span className="tabular-nums text-[var(--rn-ink-3)]">{rupees(it.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Total and actions */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--rn-line)] bg-[#FDFBF8] pl-6 pr-4 py-2.5 sm:pl-7">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--rn-ink-3)]">Total</span>
          <span className="text-[18px] font-extrabold tabular-nums text-[var(--rn-ink)]">{rupees(p.total)}</span>
          {p.note}
        </div>
        {p.actions ? <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto justify-between sm:justify-end sm:ml-auto">{p.actions}</div> : null}
      </div>
    </div>
  );
}
