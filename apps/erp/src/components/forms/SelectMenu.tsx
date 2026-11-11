"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { MSheet, useIsPhone } from "@/components/app/m";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * App dropdown in place of the browser's <select>: a field-like button that opens a list under it
 * (or above it with `up`, e.g. in a bar fixed to the bottom). Works with touch, mouse and keyboard
 * (Arrow keys, Enter, Escape); the chosen option is ticked; a tap outside closes it.
 * `tone` follows the screen: orange (delivery app) or forest (management portal).
 */
export function SelectMenu({
  value,
  options,
  onChange,
  label,
  placeholder = "Choose…",
  tone = "orange",
  up = false,
  className = "",
  triggerClassName = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  tone?: "orange" | "forest";
  up?: boolean;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);
  // Owner/manager app on phones: the choices open as a sheet (the delivery app keeps its list).
  const phone = useIsPhone();
  const asSheet = Boolean(phone) && tone === "forest";
  const accent = tone === "orange" ? { on: "bg-[#FCE9DD] text-[#B4440F]", ring: "focus-visible:ring-[#C9501C]/25" } : { on: "bg-[#DCE5D7] text-[#263B2D]", ring: "focus-visible:ring-[#5D7656]/25" };

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    if (asSheet) return;
    const away = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("touchstart", away);
    // Keep the list on screen inside scrolling sheets.
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("touchstart", away);
    };
  }, [open, options, value, asSheet]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if ((e.key === "Enter" || e.key === " ") && open) {
      e.preventDefault();
      if (options[active]) choose(options[active].value);
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`} onKeyDown={onKey}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        className={`rn-press w-full h-12 pl-4 pr-3 rounded-xl flex items-center gap-2 text-left text-[14px] font-semibold outline-none focus-visible:ring-4 ${accent.ring} ${triggerClassName || "bg-white border border-[#ECE6DB] text-[#1A2E20]"}`}
      >
        <span className={`flex-1 truncate ${current ? "" : "opacity-60"}`}>{current?.label ?? placeholder}</span>
        <ChevronsUpDown className="w-4 h-4 opacity-60 shrink-0" />
      </button>
      {asSheet && (
        <MSheet open={open} onClose={() => setOpen(false)} title={label} rootClassName="rn-select-sheet">
          <div className="m-group" role="listbox" aria-label={label}>
            {options.map((o, i) => {
              const on = o.value === value;
              return (
                <div key={o.value || `opt-${i}`} role="option" aria-selected={on} onClick={() => choose(o.value)} className={`m-option ${on ? "is-on" : ""}`}>
                  <span className="min-w-0 flex-1">{o.label}</span>
                  {on && <Check className="w-5 h-5 shrink-0" aria-hidden />}
                </div>
              );
            })}
          </div>
        </MSheet>
      )}
      {open && !asSheet && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={`rn-enter absolute z-40 left-0 right-0 ${up ? "bottom-full mb-2" : "top-full mt-1.5"} max-h-64 overflow-y-auto overscroll-contain rounded-2xl bg-white border border-[#ECE6DB] shadow-[0_12px_32px_rgba(31,35,32,0.16)] p-1`}
        >
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <li key={o.value || `opt-${i}`} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => choose(o.value)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full min-h-[44px] px-3 rounded-xl flex items-center gap-2.5 text-left text-[14px] ${on ? `${accent.on} font-semibold` : i === active ? "bg-[#F4F0E8] text-[#1F2320]" : "text-[#1F2320] hover:bg-[#F4F0E8]"}`}
                >
                  <span className="w-4 shrink-0">{on && <Check className="w-4 h-4" />}</span>
                  <span className="flex-1">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
