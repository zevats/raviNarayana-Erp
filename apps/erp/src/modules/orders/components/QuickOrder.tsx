"use client";

/**
 * "New order" from anywhere (the dashboard shortcut): the order form opens right here, the order
 * is sent in the background, and a short line confirms it (or says why it was not saved).
 */

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday } from "@/lib/businessDate";
import { toast } from "@/components/ui/toast";
import type { PendingOrderJob } from "./NewOrderModal";

const loadNewOrderModal = () => import("./NewOrderModal");
const NewOrderModal = dynamic(() => loadNewOrderModal().then((m) => m.NewOrderModal), { ssr: false });

export function useQuickOrder() {
  const [open, setOpen] = useState(false);
  // The form's code is fetched ahead, so the first tap opens it at once.
  useEffect(() => {
    const t = window.setTimeout(() => void loadNewOrderModal(), 1200);
    return () => window.clearTimeout(t);
  }, []);

  // The moment the order is confirmed in the form a message says it is being saved; the
  // confirmation (or the reason it was not saved) follows as soon as the server answers.
  const run = (job: PendingOrderJob) => {
    toast.ok(`Saving ${job.customerName}'s order…`);
    job
      .run()
      .then(({ message }) => {
        toast.ok(message);
        invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
      })
      .catch((e: any) => toast.error(`Order for ${job.customerName} was not saved: ${e?.message || "try again"}.`));
  };

  const element = (
    <>
      <NewOrderModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onOrderCreated={(message: string) => {
          toast.ok(message);
          invalidateErpCache(["orders", "delivery", "tiffin_customers", "finance", "dashboard"]);
        }}
        onSubmitInBackground={run}
        defaultDate={businessToday()}
      />
    </>
  );
  return { open: () => setOpen(true), element };
}
