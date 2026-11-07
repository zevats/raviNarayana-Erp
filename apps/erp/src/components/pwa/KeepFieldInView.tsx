"use client";

import { useEffect } from "react";

const FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, select, [contenteditable=true]";

/**
 * Keeps the field being typed in above the on-screen keyboard, everywhere in the ERP and the
 * delivery app. Browsers that resize the page for the keyboard (viewport interactive-widget) only
 * need the field scrolled into view; for Android WebViews that just cover the page, the keyboard
 * height is published as --rn-kb so open sheets and dialogs sit above it (globals.css).
 */
export function KeepFieldInView() {
  useEffect(() => {
    const vv = window.visualViewport;
    let timer = 0;
    const keyboard = () => {
      if (!vv) return 0;
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      return covered > 120 ? covered : 0;
    };
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !el.matches?.(FIELD)) return;
      const r = el.getBoundingClientRect();
      const top = vv ? vv.offsetTop : 0;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      if (r.bottom > bottom - 16 || r.top < top + 8) el.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    const onResize = () => {
      document.documentElement.style.setProperty("--rn-kb", `${keyboard()}px`);
      window.clearTimeout(timer);
      timer = window.setTimeout(reveal, 60);
    };
    const onFocus = (e: FocusEvent) => {
      if (!(e.target as HTMLElement)?.matches?.(FIELD)) return;
      window.clearTimeout(timer);
      // Wait for the keyboard to finish opening before measuring.
      timer = window.setTimeout(() => {
        document.documentElement.style.setProperty("--rn-kb", `${keyboard()}px`);
        reveal();
      }, 320);
    };
    document.addEventListener("focusin", onFocus);
    vv?.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocus);
      vv?.removeEventListener("resize", onResize);
      document.documentElement.style.removeProperty("--rn-kb");
    };
  }, []);
  return null;
}
