"use client";

import React, { useEffect, useState } from "react";
import { useBusy } from "@/lib/busy";

/**
 * The thin bar along the top edge while data or a save is on its way. It waits 120 ms before
 * showing (quick answers never flicker it) and stays at least 300 ms once shown, so a short wait
 * still reads as "done" rather than a blink.
 */
export function BusyBar() {
  const busy = useBusy();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (busy) {
      const t = window.setTimeout(() => setShown(true), 120);
      return () => window.clearTimeout(t);
    }
    if (!shown) return;
    const t = window.setTimeout(() => setShown(false), 300);
    return () => window.clearTimeout(t);
  }, [busy, shown]);
  return <div className={`rn-busybar ${shown ? "is-on" : ""} ${shown && !busy ? "is-done" : ""}`} role="progressbar" aria-hidden={!shown} aria-label="Loading" />;
}
