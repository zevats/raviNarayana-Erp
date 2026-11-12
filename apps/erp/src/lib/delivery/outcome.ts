import type { DeliveryDisposition, DeliveryLine, DeliveryTask } from "@/types";

/**
 * Delivery outcome and day summary, shared by the Delivery page and the server close-out so both
 * count the same way. Pure functions over DeliveryTask; no I/O.
 *
 * A partial delivery is its own outcome (status DELIVERED with at least one line short), and
 * delivery is independent of payment: a fully delivered stop can still have a balance due.
 */
export type DeliveryOutcome = "WAITING" | "OUT" | "DELIVERED" | "PARTIAL" | "NOT_DELIVERED" | "CANCELLED";

export const OUTCOME_LABEL: Record<DeliveryOutcome, string> = {
  WAITING: "Not assigned",
  OUT: "Out for delivery",
  DELIVERED: "Delivered",
  PARTIAL: "Partial",
  NOT_DELIVERED: "Not delivered",
  CANCELLED: "Cancelled",
};

export const DISPOSITION_LABEL: Record<DeliveryDisposition, string> = {
  RETURNED: "Returned to PG",
  WITH_STAFF: "Brought back by delivery staff",
  DISCARDED: "Damaged",
};

export function deliveryOutcome(task: Pick<DeliveryTask, "status" | "lines">): DeliveryOutcome {
  switch (task.status) {
    case "CANCELLED":
      return "CANCELLED";
    case "OUT_FOR_DELIVERY":
    case "ASSIGNED": // no waiting phase: an assigned stop is out for delivery (owner, 2026-11-12)
      return "OUT";
    case "EXCEPTION":
      return "NOT_DELIVERED";
    case "DELIVERED":
      return (task.lines ?? []).some((l) => l.deliveredQuantity !== null && l.deliveredQuantity < l.quantity) ? "PARTIAL" : "DELIVERED";
    default:
      return "WAITING";
  }
}

/** A delivery the Manager still has to look at: partial or not delivered, and not yet resolved. */
export function needsFollowUp(task: Pick<DeliveryTask, "status" | "lines" | "resolvedAt">): boolean {
  const o = deliveryOutcome(task);
  return (o === "PARTIAL" || o === "NOT_DELIVERED") && !task.resolvedAt;
}

export const undeliveredOf = (l: DeliveryLine) => (l.deliveredQuantity === null ? 0 : l.quantity - l.deliveredQuantity);

export interface DeliveryStaffSummary {
  staffId: string | null;
  staffName: string;
  stops: number;
  waiting: number;
  out: number;
  delivered: number;
  partial: number;
  notDelivered: number;
  collected: number;
}

export interface DeliveryDaySummary {
  /** All stops except cancelled ones. */
  total: number;
  waiting: number;
  out: number;
  delivered: number;
  partial: number;
  notDelivered: number;
  cancelled: number;
  unassigned: number;
  /** Partial or not delivered and not yet resolved. */
  followUp: number;
  items: {
    ordered: number;
    delivered: number;
    undelivered: number;
    /** Undelivered quantity by disposition; UNRECORDED = no disposition saved (older records). */
    byDisposition: Record<DeliveryDisposition | "UNRECORDED", number>;
  };
  /** Doorstep money (one-off orders only; subscriptions are billed monthly). */
  money: {
    /** Σ delivered × saved price for completed order deliveries. */
    due: number;
    /** Σ collections recorded against those deliveries. */
    collected: number;
    outstanding: number;
    /** Order value of order deliveries not completed yet. */
    pendingValue: number;
  };
  staff: DeliveryStaffSummary[];
}

/** Summarises every delivery of the selected day and meal (call it with the unfiltered list). */
export function summarizeDeliveries(tasks: DeliveryTask[]): DeliveryDaySummary {
  const s: DeliveryDaySummary = {
    total: 0,
    waiting: 0,
    out: 0,
    delivered: 0,
    partial: 0,
    notDelivered: 0,
    cancelled: 0,
    unassigned: 0,
    followUp: 0,
    items: { ordered: 0, delivered: 0, undelivered: 0, byDisposition: { RETURNED: 0, WITH_STAFF: 0, DISCARDED: 0, UNRECORDED: 0 } },
    money: { due: 0, collected: 0, outstanding: 0, pendingValue: 0 },
    staff: [],
  };
  const staff = new Map<string, DeliveryStaffSummary>();
  for (const t of tasks) {
    const o = deliveryOutcome(t);
    if (o === "CANCELLED") {
      s.cancelled++;
      continue;
    }
    s.total++;
    if (o === "WAITING") s.waiting++;
    else if (o === "OUT") s.out++;
    else if (o === "DELIVERED") s.delivered++;
    else if (o === "PARTIAL") s.partial++;
    else s.notDelivered++;
    if (!t.assignedTo) s.unassigned++;
    if (needsFollowUp(t)) s.followUp++;

    const completed = o === "DELIVERED" || o === "PARTIAL" || o === "NOT_DELIVERED";
    for (const l of t.lines ?? []) {
      s.items.ordered += l.quantity;
      if (!completed || l.deliveredQuantity === null) continue;
      s.items.delivered += l.deliveredQuantity;
      const short = l.quantity - l.deliveredQuantity;
      if (short > 0) {
        s.items.undelivered += short;
        s.items.byDisposition[l.disposition ?? "UNRECORDED"] += short;
      }
    }
    if (t.paymentMode === "DOORSTEP") {
      if (completed) {
        s.money.due += t.expectedAmount ?? 0;
        s.money.collected += t.collectedAmount ?? 0;
      } else {
        s.money.pendingValue += t.orderTotal ?? 0;
      }
    }

    const key = t.assignedTo ?? "__unassigned";
    const row = staff.get(key) ?? {
      staffId: t.assignedTo ?? null,
      staffName: t.assignedTo ? t.assignedToName || "Delivery staff" : "Unassigned",
      stops: 0,
      waiting: 0,
      out: 0,
      delivered: 0,
      partial: 0,
      notDelivered: 0,
      collected: 0,
    };
    row.stops++;
    if (o === "WAITING") row.waiting++;
    else if (o === "OUT") row.out++;
    else if (o === "DELIVERED") row.delivered++;
    else if (o === "PARTIAL") row.partial++;
    else row.notDelivered++;
    row.collected += t.collectedAmount ?? 0;
    staff.set(key, row);
  }
  s.money.outstanding = Math.max(0, s.money.due - s.money.collected);
  s.staff = Array.from(staff.values()).sort((a, b) => (a.staffId === null ? 1 : b.staffId === null ? -1 : a.staffName.localeCompare(b.staffName)));
  return s;
}
