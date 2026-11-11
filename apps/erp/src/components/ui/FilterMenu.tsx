"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { MSheet, useIsPhone } from "@/components/app/m";

/**
 * The filter button that sits to the right of a search box: an icon that opens the choices (a small
 * list on the website, a sheet on phones). A dot shows when something other than the default is
 * chosen.
 */
export function FilterMenu<T extends string>({
  label,
  value,
  onChange,
  options,
  defaultValue,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  defaultValue?: T;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || phone) return;
    const away = (e: Event) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open, phone]);
  const changed = defaultValue !== undefined && value !== defaultValue;
  const current = options.find((o) => o.value === value)?.label ?? "";
  const list = (
    <div role="menu" aria-label={label} className={phone ? "m-group p-1.5" : ""}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={o.value === value}
          onClick={() => {
            onChange(o.value);
            setOpen(false);
          }}
          className="w-full min-h-[44px] px-3 rounded-xl flex items-center gap-2.5 text-left text-[14.5px] text-[var(--rn-ink)] hover:bg-[var(--rn-accent-tint)]"
        >
          <span className="flex-1 min-w-0 truncate">{o.label}</span>
          {o.count !== undefined && <span className="text-[13px] tabular-nums text-[var(--rn-ink-3)]">{o.count}</span>}
          <Check className={`w-4 h-4 shrink-0 ${o.value === value ? "text-[var(--rn-accent)]" : "opacity-0"}`} aria-hidden />
        </button>
      ))}
    </div>
  );
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${current}`} title={`${label}: ${current}`} className="rn-btn rn-btn-icon relative">
        <SlidersHorizontal />
        {changed && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#C9501C]" aria-hidden />}
      </button>
      {phone ? (
        <MSheet open={open} onClose={() => setOpen(false)} title={label} rootClassName="rn-select-sheet">
          {list}
        </MSheet>
      ) : (
        open && <div className="rn-pop absolute right-0 top-full mt-2 z-50 w-56 rounded-2xl p-1.5">{list}</div>
      )}
    </div>
  );
}
