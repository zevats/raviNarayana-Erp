"use client";

import { useEffect } from "react";
import { prefetchQuery, queriesForRoute } from "@/lib/pageQueries";

const SECTIONS = ["/orders", "/delivery", "/finance?tab=cashbook", "/finance?tab=receivables", "/finance?tab=invoices", "/tiffin", "/residents", "/rooms"];

/**
 * Loads each section's data ahead of time, so opening it shows the data at once:
 *  - shortly after the app is idle, the main sections (two at a time, quietly);
 *  - the moment a finger touches (or the mouse rests on) a link to a section.
 * Only what is missing or stale is fetched; delivery staff have their own small app.
 */
export function DataPrefetch({ role }: { role: string }) {
  useEffect(() => {
    if (role === "DELIVERY_PERSON") return;
    let cancelled = false;
    const run = async () => {
      const all = SECTIONS.flatMap((s) => queriesForRoute(s, role));
      for (let i = 0; i < all.length && !cancelled; i += 2) {
        all.slice(i, i + 2).forEach(prefetchQuery);
        await new Promise((r) => setTimeout(r, 400));
      }
    };
    const idle = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number);
    const t = window.setTimeout(() => (idle ? idle(() => void run(), { timeout: 3000 }) : void run()), 1500);

    const onIntent = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("/")) return;
      queriesForRoute(href, role).forEach(prefetchQuery);
    };
    document.addEventListener("pointerdown", onIntent, true);
    document.addEventListener("pointerover", onIntent, true);
    document.addEventListener("focusin", onIntent, true);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onIntent, true);
      document.removeEventListener("pointerover", onIntent, true);
      document.removeEventListener("focusin", onIntent, true);
    };
  }, [role]);
  return null;
}
