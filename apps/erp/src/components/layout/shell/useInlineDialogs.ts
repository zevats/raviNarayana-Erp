"use client";

import { useEffect, type RefObject } from "react";

/**
 * Pages in the manager ERP draw their dialogs inline: a `fixed inset-0` backdrop with the form
 * panel inside. This gives every one of them the behaviour a dialog needs, in one place:
 * - role="dialog" and aria-modal on the panel;
 * - focus moves to the first field when it opens, and Tab stays inside the dialog;
 * - Escape closes it through the dialog's own Cancel/Close control (so each form's own
 *   close logic and unsaved-change handling still run);
 * - focus returns to the control that opened it once it closes.
 * Only the topmost dialog reacts, so a dialog opened from another dialog behaves correctly.
 */
const OVERLAY = ".fixed.inset-0";
const FOCUSABLE = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function visibleOverlays(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(OVERLAY)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.querySelector(FOCUSABLE) !== null;
  });
}

function panelOf(overlay: HTMLElement): HTMLElement {
  return (Array.from(overlay.children).find((c) => (c as HTMLElement).getBoundingClientRect().height > 40) as HTMLElement) || overlay;
}

function closeControl(overlay: HTMLElement): HTMLElement | null {
  const buttons = Array.from(overlay.querySelectorAll<HTMLElement>("button")).filter((b) => !b.hasAttribute("disabled") && b.offsetParent !== null);
  return (
    buttons.find((b) => /^(cancel|close|done|×|✕)$/i.test((b.innerText || "").trim())) ||
    buttons.find((b) => /close|cancel|dismiss/i.test(`${b.getAttribute("aria-label") || ""} ${b.getAttribute("title") || ""}`)) ||
    buttons.find((b) => !(b.innerText || "").trim() && b.querySelector("svg.lucide-x")) ||
    null
  );
}

export function useInlineDialogs(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const opener = new WeakMap<HTMLElement, Element | null>();
    let known = new Set<HTMLElement>();
    let lastPointerTarget: Element | null = null;
    let frame = 0;

    const onPointer = (e: Event) => { lastPointerTarget = e.target instanceof Element ? e.target : null; };

    const sync = () => {
      frame = 0;
      // Most changes (typing, list refreshes) happen with no dialog open: skip the layout reads.
      if (known.size === 0 && !el.querySelector(OVERLAY)) return;
      const now = visibleOverlays(el);
      for (const ov of now) {
        if (known.has(ov)) continue;
        // Newly opened: remember who opened it, label it, move focus inside.
        opener.set(ov, (document.activeElement && document.activeElement !== document.body ? document.activeElement : lastPointerTarget?.closest("button, a")) || null);
        const panel = panelOf(ov);
        if (!panel.hasAttribute("role")) panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");
        const heading = panel.querySelector("h1, h2, h3");
        if (heading && !panel.hasAttribute("aria-labelledby") && !panel.hasAttribute("aria-label")) {
          if (!heading.id) heading.id = `rn-dlg-${Math.random().toString(36).slice(2, 8)}`;
          panel.setAttribute("aria-labelledby", heading.id);
        }
        if (!ov.contains(document.activeElement)) {
          const first = panel.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])") || panel.querySelector<HTMLElement>(FOCUSABLE);
          if (first) first.focus({ preventScroll: true });
          else { panel.setAttribute("tabindex", "-1"); panel.focus({ preventScroll: true }); }
        }
      }
      for (const ov of Array.from(known)) {
        if (now.includes(ov)) continue;
        // Closed: give focus back to what opened it, if it is still on the page.
        const back = opener.get(ov) as HTMLElement | null | undefined;
        if (back && document.contains(back) && typeof back.focus === "function") back.focus({ preventScroll: true });
      }
      known = new Set(now);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      if (known.size === 0 && !el.querySelector(OVERLAY)) return;
      const overlays = visibleOverlays(el);
      const top = overlays[overlays.length - 1];
      if (!top) return;
      if (e.key === "Escape") {
        // The target can be the document itself (no element focused).
        const target = e.target instanceof Element ? e.target : null;
        // An open custom list or menu inside the dialog handles Escape itself (a native <select>
        // popup consumes Escape before the page sees it).
        if (target && target.closest("[role=listbox], [role=menu]")) return;
        const close = closeControl(top);
        if (close) {
          e.preventDefault();
          close.click();
        }
      } else if (e.key === "Tab") {
        const items = Array.from(top.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(sync); });
    observer.observe(el, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);
}
