"use client";

import React, { useEffect } from "react";
import { X, Phone, MapPin, Navigation, Pencil, Wallet, Power, CalendarDays, StickyNote, UtensilsCrossed, ReceiptText } from "lucide-react";
import { TiffinCustomer, TiffinSubscription } from "@/types";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { formatINR } from "@/modules/finance/utils/formatUtils";
import type { CustomerMonth } from "@/server/orders/orderService";

const SUB_STATUS: Record<string, [string, string]> = {
  ACTIVE: ["Active", "bg-[#E4F2E0] text-[#2F6B24]"],
  PAUSED: ["Paused", "bg-[#FBF1DE] text-[#8F6710]"],
  CANCELLED: ["Cancelled", "bg-[#EEECE8] text-[#6E6A63]"],
  COMPLETED: ["Completed", "bg-[#E6EEF6] text-[#2D5277]"],
};
const MEALS_LABEL: Record<string, string> = { LUNCH: "Lunch", DINNER: "Dinner", BOTH: "Lunch + dinner", ANY: "Any meal", BREAKFAST: "Breakfast" };
const TYPE_LABEL: Record<string, string> = { INDIVIDUAL: "Individual", CORPORATE: "Corporate", RESIDENTIAL_PG: "PG resident" };

interface CustomerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: TiffinCustomer | null;
  onEdit?: (customer: TiffinCustomer) => void;
  onToggleStatus?: (customer: TiffinCustomer) => void;
  /** Opens the customer's invoices, payments and balance. */
  onViewAccount?: (customer: TiffinCustomer) => void;
}

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("") || "?";

const dayLabel = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const shortDate = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Payment state of an order or bill, in plain words. */
function PayPill({ kind, due }: { kind: "PAID" | "PART_PAID" | "UNPAID" | "PAY_LATER" | "IN_PLAN"; due: number }) {
  const map: Record<string, [string, string]> = {
    PAID: ["Paid", "bg-[#E4F2E0] text-[#1D4E16]"],
    IN_PLAN: ["In plan", "bg-[#EEF3EA] text-[#1E3A2B]"],
    PART_PAID: [`Part paid · ${formatINR(due)} due`, "bg-[#FBF0D9] text-[#6B4A06]"],
    PAY_LATER: [`On account · ${formatINR(due)}`, "bg-[#FBF0D9] text-[#6B4A06]"],
    UNPAID: [`Unpaid · ${formatINR(due)}`, "bg-[#FDECE8] text-[#A3311D]"],
  };
  const [label, cls] = map[kind] || map.UNPAID;
  return <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-[#ECE6DB] p-4">
      <h3 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#8E9F89] mb-3">
        <span className="text-[#B58A57]">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Everything about one tiffin customer: balance, contact, delivery details, subscriptions and actions. */
export function CustomerDetailModal({ isOpen, onClose, customer, onEdit, onToggleStatus, onViewAccount }: CustomerDetailModalProps) {
  const subsKey = isOpen && customer ? `/api/tiffin/subscriptions?customerId=${encodeURIComponent(customer.id)}` : null;
  const subsQ = useErpQuery<{ subscriptions: TiffinSubscription[] }>(
    subsKey,
    async () => {
      const res = await fetch(subsKey as string, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load subscriptions.");
      return body;
    },
    { ttl: 15000, tags: ["tiffin_subscriptions", "subscriptions"] }
  );

  // Orders and monthly bills: this month and the two before, with what is paid and what is due.
  const actKey = isOpen && customer ? `/api/tiffin/customers/${encodeURIComponent(customer.id)}/orders?months=3` : null;
  const actQ = useErpQuery<{ months: CustomerMonth[] }>(
    actKey,
    async () => {
      const res = await fetch(actKey as string, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load the orders.");
      return body;
    },
    { ttl: 15000, tags: ["orders", "finance", "tiffin_customers"] }
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !customer) return null;
  const subscriptions = subsQ.data?.subscriptions ?? [];
  const isActive = customer.status === "ACTIVE";
  const b = customer.balance ?? null;
  const due = b?.due ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#1A2E20]/45 backdrop-blur-[2px] sm:p-4 rn-modal-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-detail-title"
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: "#F7F5F0" }}
        className="rn-modal rn-rise relative w-full sm:max-w-xl max-h-[94dvh] flex flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] shadow-[0_24px_60px_-20px_rgba(26,46,32,0.45)]"
      >
        {/* Header */}
        <header className="relative px-5 sm:px-6 pt-4 pb-3 text-[#18211B]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-3.5 w-[38px] h-[38px] rounded-full bg-[#ECE8DF] text-[#18211B] flex items-center justify-center transition-colors"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
          <div className="flex items-center gap-3.5 pr-10">
            <div className="w-14 h-14 rounded-full bg-[#FCE8DB] text-[#BF521E] flex items-center justify-center text-[17px] font-semibold shrink-0">{initialsOf(customer.fullName)}</div>
            <div className="min-w-0">
              <h2 id="customer-detail-title" className="text-[20px] leading-tight font-semibold tracking-[-0.015em] text-[#18211B] truncate">
                {customer.fullName}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#727C74]">
                {customer.customerCode && <span className="font-semibold text-[#BF521E] tabular-nums">{customer.customerCode}</span>}
                <span>{TYPE_LABEL[customer.customerType] || customer.customerType}</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${
                    isActive ? "bg-[#E6F2E2] text-[#2D6A24]" : "bg-[#F1EEE7] text-[#48534B]"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[#3C8A2E]" : "bg-[#9AA39C]"}`} />
                  {isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 pt-4 pb-6 space-y-3">
          {/* Balance */}
          <section className="rounded-2xl bg-white border border-[#ECE6DB] p-4" aria-label="Balance">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[#8E9F89]">{due < 0 ? "Paid ahead" : "Balance due"}</p>
                <p className={`mt-1 text-[30px] leading-none font-extrabold tabular-nums ${due > 0 ? "text-[#B4440F]" : due < 0 ? "text-[#2F6B24]" : "text-[#1A2E20]"}`}>
                  {b ? formatINR(Math.abs(due)) : "—"}
                </p>
              </div>
              {onViewAccount && (
                <button
                  type="button"
                  onClick={() => onViewAccount(customer)}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-[#F3EADD] text-[#6E4E28] text-[13px] font-semibold hover:bg-[#EBDDC8] transition-colors"
                >
                  <Wallet className="w-4 h-4" />
                  Invoices &amp; payments
                </button>
              )}
            </div>
            {b && (
              <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ["Delivered orders", formatINR(b.orders)],
                  ["Tiffin bills", formatINR(b.bills)],
                  ["Paid ahead", formatINR(b.credit)],
                  ["Unpaid since", b.oldestUnpaid ? dayLabel(b.oldestUnpaid) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-[#FAF8F5] px-3 py-2.5 min-w-0">
                    <dt className="text-[11px] text-[#7A8A7C]">{k}</dt>
                    <dd className="text-[14px] font-semibold text-[#1A2E20] tabular-nums truncate">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {b && b.unpaidOrders > 0 && (
              <p className="mt-3 text-[12.5px] text-[#5A6C5E]">
                {b.unpaidOrders} delivered order{b.unpaidOrders === 1 ? "" : "s"} not fully paid. Pay Later is open to every customer.
              </p>
            )}
          </section>

          {/* Contact */}
          <Section icon={<Phone className="w-3.5 h-3.5" />} title="Contact">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[#1A2E20] tabular-nums">{customer.phone}</p>
                {customer.alternatePhone && <p className="text-[13px] text-[#5A6C5E] tabular-nums">Alternate {customer.alternatePhone}</p>}
              </div>
              <a
                href={`tel:${customer.phone}`}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-[#E2DBCE] text-[13px] font-semibold text-[#1A2E20] hover:bg-[#FAF8F5] shrink-0"
              >
                <Phone className="w-3.5 h-3.5 text-[#B58A57]" />
                Call
              </a>
            </div>
          </Section>

          {/* Delivery */}
          <Section icon={<MapPin className="w-3.5 h-3.5" />} title="Delivery">
            <p className="text-[14px] text-[#1A2E20] leading-relaxed">{customer.deliveryAddress}</p>
            {customer.landmark && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-[#5A6C5E]">
                <Navigation className="w-3.5 h-3.5 text-[#8E9F89] mt-0.5 shrink-0" />
                Near {customer.landmark}
              </p>
            )}
            {customer.deliveryInstructions && (
              <p className="mt-3 rounded-xl bg-[#FAF8F5] px-3 py-2.5 text-[13px] text-[#3E4E42]">{customer.deliveryInstructions}</p>
            )}
          </Section>

          {/* Subscriptions */}
          <Section icon={<UtensilsCrossed className="w-3.5 h-3.5" />} title="Subscriptions">
            {subsQ.isLoading && !subsQ.data ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-12 rounded-xl bg-[#F4F0E8] animate-pulse" />
              </div>
            ) : subsQ.error && !subsQ.data ? (
              <p className="text-[13px] text-[#9A3423]">Couldn&apos;t load subscriptions. {subsQ.error.message}</p>
            ) : subscriptions.length === 0 ? (
              <p className="text-[13px] text-[#7A8A7C]">No subscriptions.</p>
            ) : (
              <ul className="divide-y divide-[#F1ECE3]">
                {subscriptions.map((sub) => {
                  const [label, cls] = SUB_STATUS[sub.status] || [sub.status, "bg-[#EEECE8] text-[#6E6A63]"];
                  return (
                    <li key={sub.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-[#1A2E20] truncate">{sub.productName || "Meal plan"}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[#5A6C5E]">
                          <CalendarDays className="w-3.5 h-3.5 text-[#8E9F89] shrink-0" />
                          <span className="truncate">
                            {MEALS_LABEL[sub.mealTypes] || sub.mealTypes} · {sub.quantityPerMeal} per meal · from {dayLabel(sub.startDate)}
                            {sub.endDate ? ` to ${dayLabel(sub.endDate)}` : ""}
                          </span>
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11.5px] font-semibold ${cls}`}>{label}</span>
                        <p className="mt-1 text-[13px] font-semibold text-[#1A2E20] tabular-nums">{formatINR(sub.price)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Orders and payments, month by month */}
          <Section icon={<ReceiptText className="w-3.5 h-3.5" />} title="Orders and payments · last 3 months">
            {actQ.isLoading && !actQ.data ? (
              <div className="space-y-2" aria-busy="true">
                <div className="h-14 rounded-xl bg-[#F4F0E8] animate-pulse" />
                <div className="h-14 rounded-xl bg-[#F4F0E8] animate-pulse" />
              </div>
            ) : actQ.error && !actQ.data ? (
              <p className="text-[13px] text-[#9A3423]">Couldn&apos;t load the orders. {actQ.error.message}</p>
            ) : (
              <div className="space-y-4">
                {(actQ.data?.months ?? []).map((mo) => (
                  <div key={mo.month}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-[14px] font-semibold text-[#1E2320]">{mo.label}</p>
                      <p className="text-[12.5px] text-[#4A504B] tabular-nums">
                        {mo.totals.orders} order{mo.totals.orders === 1 ? "" : "s"}
                        {mo.bills.length > 0 ? ` · ${mo.bills.length} bill${mo.bills.length === 1 ? "" : "s"}` : ""}
                        {" · "}
                        <span className="text-[#2F6B24] font-semibold">Paid {formatINR(mo.totals.paid)}</span>
                        {mo.totals.due > 0 && <span className="text-[#A3311D] font-semibold"> · Due {formatINR(mo.totals.due)}</span>}
                      </p>
                    </div>
                    {mo.orders.length === 0 && mo.bills.length === 0 ? (
                      <p className="mt-1.5 text-[13px] text-[#4A504B]">No orders or bills.</p>
                    ) : (
                      <ul className="mt-2 rounded-xl border border-[#EFE9DF] divide-y divide-[#F1ECE3] bg-[#FDFCFA]">
                        {mo.bills.map((b) => (
                          <li key={b.invoiceId} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-medium text-[#1E2320] truncate">Monthly bill{b.number ? ` ${b.number}` : ""}</span>
                              <span className="block text-[12px] text-[#4A504B]">Issued {dayLabel(b.issueDate)}</span>
                            </span>
                            <span className="text-right">
                              <span className="block text-[13.5px] font-semibold tabular-nums text-[#1E2320]">{formatINR(b.total)}</span>
                              <PayPill kind={b.due === 0 ? "PAID" : b.paid > 0 ? "PART_PAID" : "UNPAID"} due={b.due} />
                            </span>
                          </li>
                        ))}
                        {mo.orders.map((o) => (
                          <li key={o.orderId} className="flex items-center gap-3 px-3 py-2.5">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-medium text-[#1E2320]">
                                {shortDate(o.date)} · {o.mealType === "DINNER" ? "Dinner" : o.mealType === "BREAKFAST" ? "Breakfast" : o.mealType === "LUNCH" ? "Lunch" : o.mealType} · {o.orderType === "DINE_IN" ? "Dine in" : "Delivery"}
                              </span>
                              <span className="block text-[12px] text-[#4A504B] truncate" title={o.items}>{o.items || "—"}</span>
                            </span>
                            <span className="text-right shrink-0">
                              <span className="block text-[13.5px] font-semibold tabular-nums text-[#1E2320]">{formatINR(o.total)}</span>
                              <PayPill kind={o.payment} due={o.due} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {customer.notes && (
            <Section icon={<StickyNote className="w-3.5 h-3.5" />} title="Notes">
              <p className="text-[13.5px] text-[#3E4E42] leading-relaxed whitespace-pre-line">{customer.notes}</p>
            </Section>
          )}

          <p className="px-1 text-[12px] text-[#8E9F89]">
            Customer since {dayLabel(customer.createdAt)}
            {customer.createdByName ? ` · added by ${customer.createdByName}` : ""}
            {customer.updatedByName ? ` · last edited by ${customer.updatedByName}` : ""}
          </p>
        </div>

        {/* Actions */}
        <footer className="shrink-0 px-5 sm:px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-white border-t border-[#ECE6DB] flex items-center gap-3">
          {onToggleStatus && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onToggleStatus(customer);
              }}
              className={`inline-flex items-center gap-1.5 h-11 px-4 rounded-full border text-[13.5px] font-semibold transition-colors ${
                isActive ? "border-[#E8C4BA] text-[#9A3423] hover:bg-[#FBE9E4]" : "border-[#BFDDB6] text-[#2F6B24] hover:bg-[#E4F2E0]"
              }`}
            >
              <Power className="w-4 h-4" />
              {isActive ? "Deactivate" : "Reactivate"}
            </button>
          )}
          <div className="flex-1" />
          {onEdit && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(customer);
              }}
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full bg-[#1A2E20] text-white text-[13.5px] font-semibold hover:bg-[#263B2D] transition-colors"
            >
              <Pencil className="w-4 h-4 text-[#E4C9A4]" />
              Edit details
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
