"use client";

import React, { useEffect, useState } from "react";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { TiffinCustomerDirectory } from "@/modules/tiffin/components/TiffinCustomerDirectory";
import { PageHeader, Segmented } from "@/components/ui/kit";
import dynamic from "next/dynamic";
import { preloadWhenIdle } from "@/lib/preloadWhenIdle";

// Dialogs and secondary views load on demand, off the navigation path.
const loadTiffinSubscriptionList = () => import("@/modules/tiffin/components/TiffinSubscriptionList");
const TiffinSubscriptionList = dynamic(() => loadTiffinSubscriptionList().then((m) => m.TiffinSubscriptionList), { ssr: false });
const loadTiffinPricingCatalog = () => import("@/modules/tiffin/components/TiffinPricingCatalog");
const TiffinPricingCatalog = dynamic(() => loadTiffinPricingCatalog().then((m) => m.TiffinPricingCatalog), { ssr: false });
const loadTiffinBillingView = () => import("@/modules/tiffin/components/TiffinBillingView");
const TiffinBillingView = dynamic(() => loadTiffinBillingView().then((m) => m.TiffinBillingView), { ssr: false });

type Tab = "customers" | "subscriptions" | "products" | "billing";

/**
 * Tiffin management: customers, subscriptions, the menu and prices, and monthly billing.
 * Billing (invoices and payments) is Owner-only, as on the server (`finance.manage`).
 */
export default function TiffinPage() {
  // Fetch the dialog and tab code in the background so the first click opens at once.
  useEffect(() => preloadWhenIdle([loadTiffinSubscriptionList, loadTiffinPricingCatalog, loadTiffinBillingView]), []);
  const canBill = useHasPermission("finance.manage");
  const [tab, setTab] = useState<Tab>("customers");
  // Links from notifications open a tab: /tiffin?tab=subscriptions
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "customers" || t === "subscriptions" || t === "products" || (t === "billing" && canBill)) setTab(t);
  }, [canBill]);

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "customers", label: "Customers" },
    { value: "subscriptions", label: "Subscriptions" },
    { value: "products", label: "Menu & prices" },
    ...(canBill ? [{ value: "billing" as Tab, label: "Billing" }] : []),
  ];

  return (
    <div className="space-y-5 min-w-0">
      <PageHeader title="Tiffin customers" actions={<Segmented label="Tiffin sections" value={tab} onChange={setTab} options={tabs} />} />

      {tab === "customers" && <TiffinCustomerDirectory />}
      {tab === "subscriptions" && <TiffinSubscriptionList />}
      {tab === "products" && <TiffinPricingCatalog />}
      {tab === "billing" && canBill && <TiffinBillingView />}
    </div>
  );
}
