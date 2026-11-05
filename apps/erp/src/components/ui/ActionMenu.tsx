"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ElementType;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Shown under the label when the item is disabled, so the reason is never hidden. */
  hint?: string;
}

/**
 * Three-dot menu for row actions. The list is drawn in the shell root (so no card, table or
 * scroll container can clip it), placed under the trigger or above it when there is no room,
 * and kept inside the viewport (it follows the trigger when the page scrolls). Closes on outside
 * click, Escape, or when the trigger scrolls off screen; arrow keys
 * move between items.
 */
export function ActionMenu({ items, label = "More actions", align = "end" }: { items: ActionMenuItem[]; label?: string; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => setHost((document.querySelector(".rn-app") as HTMLElement) || document.body), []);

  const place = useCallback(() => {
    const t = trigger.current?.getBoundingClientRect();
    const m = menu.current;
    if (!t || !m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = t.bottom + 6 + h <= vh - 8;
    const top = below ? t.bottom + 6 : Math.max(8, t.top - 6 - h);
    const left = Math.min(vw - w - 8, Math.max(8, align === "end" ? t.right - w : t.left));
    setPos({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])");
    first?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      if (menu.current?.contains(e.target as Node) || trigger.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Follow the trigger while the page scrolls; close only once the trigger leaves the screen.
    const follow = () => {
      const t = trigger.current?.getBoundingClientRect();
      if (!t || t.bottom < 0 || t.top > window.innerHeight) setOpen(false);
      else place();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
  }, [open, place]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rn-btn rn-btn-sm rn-btn-icon"
      >
        <MoreVertical />
      </button>
      {open && host &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="rn-pop rn-menu z-[60] min-w-[210px] max-w-[min(280px,calc(100vw-16px))] rounded-2xl p-1.5"
          >
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                  className={`rn-menu-item ${it.tone === "danger" ? "rn-menu-danger" : ""}`}
                >
                  {Icon && <Icon aria-hidden />}
                  <span className="min-w-0">
                    <span className="block">{it.label}</span>
                    {it.disabled && it.hint && <span className="block text-[11.5px] font-normal text-[var(--rn-ink-3)]">{it.hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>,
          host
        )}
    </>
  );
}
