"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { BikeLoader } from "./BikeLoader";

/**
 * Height that fills the visible area from this element down to the floating/fixed bottom bar
 * (marked data-bottom-bar) or to the bottom of the screen, so whatever is centred inside sits
 * in the middle of what the person actually sees — in either app, on phones and desktops.
 * Measured before the first paint and again on resize/rotation.
 */
export function useFillHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const bar = [...document.querySelectorAll<HTMLElement>("[data-bottom-bar]")].find((b) => b.getBoundingClientRect().height > 0);
      const bottom = bar ? bar.getBoundingClientRect().top - 12 : window.innerHeight - 16;
      setHeight(Math.max(220, Math.round(bottom - top)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return { ref, style: height ? { minHeight: height } : undefined };
}

/** Loading stage for a whole page: the riding scooter in the middle of the visible area. */
export function FullPageLoader({ label = "Loading…", tone = "auto", size = "lg" }: { label?: string; tone?: "auto" | "orange" | "forest"; size?: "md" | "lg" }) {
  const fill = useFillHeight<HTMLDivElement>();
  return (
    <div ref={fill.ref} style={fill.style} className="min-h-[calc(100dvh-9rem)] lg:min-h-[calc(100dvh-7rem)] flex items-center justify-center select-none">
      <BikeLoader label={label} tone={tone} size={size} />
    </div>
  );
}
