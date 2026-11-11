"use client";

import React, { useEffect, useState } from "react";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { StaffDelivery } from "@/modules/delivery/ops/StaffDelivery";
import { MSegment } from "@/components/app/m";
import { Segmented } from "@/components/ui/kit";

type View = "stops" | "cash" | "history";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "stops", label: "My stops" },
  { value: "cash", label: "My cash" },
  { value: "history", label: "History" },
];

/**
 * My deliveries (Owner / Manager): the delivery app for the stops given to you, inside the ERP.
 * The same screens delivery staff use (stops, cash, history), showing only your own stops; the
 * three views switch at once, and the page is kept warm like every other section.
 */
export default function MyDeliveriesPage() {
  const user = useCurrentUser();
  const [view, setView] = useState<View>("stops");
  useEffect(() => {
    const on = (e: Event) => setView((e as CustomEvent<View>).detail);
    window.addEventListener("erp:delivery-view-changed", on);
    return () => window.removeEventListener("erp:delivery-view-changed", on);
  }, []);
  const go = (v: View) => {
    setView(v);
    window.dispatchEvent(new CustomEvent("erp:delivery-view", { detail: v }));
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  };
  if (!user) return null;
  return (
    <div className="space-y-4 min-w-0">
      <div className="lg:hidden">
        <MSegment label="My deliveries" value={view} onChange={go} options={VIEWS} />
      </div>
      <div className="hidden lg:flex items-center justify-between gap-3">
        <h1 className="rn-t-page">My deliveries</h1>
        <Segmented label="My deliveries" value={view} onChange={go} options={VIEWS} />
      </div>
      <StaffDelivery user={user} basePath="/my-deliveries" />
    </div>
  );
}
