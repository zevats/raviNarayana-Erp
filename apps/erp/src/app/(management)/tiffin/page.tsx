"use client";

import React, { useEffect, useState } from "react";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { TiffinCustomerDirectory } from "@/modules/tiffin/components/TiffinCustomerDirectory";
import { PageHeader, Segmented } from "@/components/ui/kit";
import { MSegment } from "@/components/app/m";
import dynamic from "next/dynamic";
import { preloadWhenIdle } from "@/lib/preloadWhenIdle";

// Dialogs and secondary views load on demand, off the navigation path.
const loadSubscriptionsView = () => import("@/modules/tiffin/components/SubscriptionsView");
const SubscriptionsView = dynamic(() => loadSubscriptionsView().then((m) => m.SubscriptionsView), { ssr: false });
const loadDues = () => import("@/modules/billing/DuesList");
const DuesList = dynamic(() => loadDues().then((m) => m.DuesList), { ssr: false });

type Tab = "customers" | "subscriptions" | "billing";

/**
 * Tiffin management: customers, subscriptions and dues. The menu and its prices are edited in
 * Orders → Menu. Dues (who owes, bills, receiving payments) is for Owner and Manager.
 */
export default function TiffinPage() {
  // Fetch the dialog and tab code in the background so the first click opens at once.
  useEffect(() => preloadWhenIdle([loadSubscriptionsView, loadDues]), []);
  const canBill = useHasPermission("finance.read");
  const [tab, setTab] = useState<Tab>("customers");
  // Links from notifications open a tab: /tiffin?tab=subscriptions
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "customers" || t === "subscriptions" || (t === "billing" && canBill)) setTab(t);
  }, [canBill]);

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "customers", label: "Customers" },
    { value: "subscriptions", label: "Subscriptions" },
    ...(canBill ? [{ value: "billing" as Tab, label: "Dues" }] : []),
  ];

  return (
    <div className="space-y-5 min-w-0">
      <div className="lg:hidden">
        <MSegment label="Tiffin sections" value={tab} onChange={setTab} options={tabs} />
      </div>
      <div className="hidden lg:block">
        <PageHeader title="Tiffin customers" actions={<Segmented label="Tiffin sections" value={tab} onChange={setTab} options={tabs} />} />
      </div>

      {tab === "customers" && <TiffinCustomerDirectory />}
      {tab === "subscriptions" && <SubscriptionsView />}
      {tab === "billing" && canBill && <DuesList scope="CUSTOMER" />}
    </div>
  );
}
