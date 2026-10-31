import type { DeliveryTask, MealType } from "@/types";
import { deliveryOutcome, OUTCOME_LABEL, undeliveredOf } from "@/lib/delivery/outcome";

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const time = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "");

/** Manager / Owner: downloads a day's deliveries for one meal as a CSV (audit record). */
export function exportDeliveryDay(tasks: DeliveryTask[], date: string, meal: MealType) {
  const head = ["Customer", "Room / address", "Delivery person", "Outcome", "Items delivered / ordered", "Not delivered (reason, where it went)", "Received by", "Time", "Payment", "Collected", "Still due", "Cancelled reason"];
  const rows = tasks.map((t) => {
    const lines = t.lines ?? [];
    return [
      t.orderType === "RESIDENT" ? t.residentName : t.customerName,
      t.orderType === "RESIDENT" ? `Room ${t.roomNumber ?? ""}` : t.deliveryAddress,
      t.assignedToName || "Unassigned",
      OUTCOME_LABEL[deliveryOutcome(t)],
      `${lines.reduce((n, l) => n + (l.deliveredQuantity ?? 0), 0)} / ${lines.reduce((n, l) => n + l.quantity, 0)}`,
      lines.filter((l) => undeliveredOf(l) > 0).map((l) => `${undeliveredOf(l)} ${l.productName}: ${l.undeliveredReason || ""} (${l.disposition || "not recorded"})`).join("; "),
      t.recipientName || "",
      time(t.deliveredAt || t.exceptionAt),
      t.paymentMode === "MONTHLY" ? "Monthly plan" : t.paymentMode === "NONE" ? "Resident" : "At the door",
      t.collectedAmount ?? 0,
      t.balanceDue ?? 0,
      t.cancelReason || "",
    ];
  });
  const csv = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `deliveries-${date}-${meal.toLowerCase()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
