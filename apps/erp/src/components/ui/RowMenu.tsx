"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/**
 * The "⋯" menu at the end of a table row: secondary actions live here so a row shows one main
 * action only. The list is drawn above the page (portal), so a scrolling table never clips it; it
 * closes on a tap outside, on Escape and on scroll.
 */
export function RowMenu({ items, label = "More actions" }: { items: RowMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = shown.length * 46 + 12;
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 232, r.right - 224)), up });
  }, [open, shown.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || list.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const close = () => setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("touchstart", away);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("touchstart", away);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (shown.length === 0) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="rn-btn rn-btn-sm rn-btn-icon"
      >
        <MoreHorizontal />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={list}
            role="menu"
            className="rn-pop fixed z-[80] w-56 rounded-2xl p-1.5 shadow-[0_18px_40px_-18px_rgba(20,30,24,0.45)]"
            style={{ top: pos.top, left: pos.left, background: "#FFFFFF", animation: "rn-modal-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) backwards" }}
            onClick={(e) => e.stopPropagation()}
          >
            {shown.map((it) => (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={`w-full min-h-[44px] px-3 rounded-xl flex items-center gap-2.5 text-left text-[14px] transition-colors [&>svg]:w-4 [&>svg]:h-4 ${
                  it.danger ? "text-[#9A3423] hover:bg-[#FBEDE8]" : "text-[#1E2320] hover:bg-[#EEF3EA]"
                }`}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
