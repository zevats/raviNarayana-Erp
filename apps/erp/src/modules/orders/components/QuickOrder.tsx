"use client";

/**
 * "New order" from anywhere (the dashboard shortcut): the order form opens right here, the order
 * is sent in the background, and a short line confirms it (or says why it was not saved).
 */

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday } from "@/lib/businessDate";
import { MNotice } from "@/components/app/m";
import type { PendingOrderJob } from "./NewOrderModal";

const loadNewOrderModal = () => import("./NewOrderModal");
const NewOrderModal = dynamic(() => loadNewOrderModal().then((m) => m.NewOrderModal), { ssr: false });

export function useQuickOrder() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  // The form's code is fetched ahead, so the first tap opens it at once.
  useEffect(() => {
    const t = window.setTimeout(() => void loadNewOrderModal(), 1200);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const run = (job: PendingOrderJob) => {
    job
      .run()
      .then(({ message }) => {
        setNotice({ tone: "green", text: message });
        invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
      })
      .catch((e: any) => setNotice({ tone: "red", text: `Order for ${job.customerName} was not saved: ${e?.message || "try again"}.` }));
  };

  const element = (
    <>
      {notice && (
        <div className="fixed left-3 right-3 z-[45] bottom-[calc(6.5rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-6 lg:bottom-6 lg:w-[420px]">
          <MNotice tone={notice.tone} onClose={() => setNotice(null)}>
            {notice.text}
          </MNotice>
        </div>
      )}
      <NewOrderModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onOrderCreated={(message: string) => {
          setNotice({ tone: "green", text: message });
          invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
        }}
        onSubmitInBackground={run}
        defaultDate={businessToday()}
      />
    </>
  );
  return { open: () => setOpen(true), element };
}
