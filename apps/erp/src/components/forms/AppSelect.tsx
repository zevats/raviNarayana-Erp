"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * The app's dropdown, a drop-in for <select> in every form: the same props (value, onChange with
 * e.target.value, <option>/<optgroup> children, className, disabled, required, id, name,
 * aria-label), drawn as a field-like button that opens our own list instead of the browser's.
 *
 * - The list opens under the field (above it when there is no room), floats over dialogs and
 *   scrolling panels, matches the field's width, and closes on a tap outside, Escape or scroll of
 *   the page behind it.
 * - Keyboard: Arrow keys move (and, while closed, change the value like a native select), Home/End,
 *   Enter or Space open/choose, typing a letter jumps to the next option starting with it.
 * - A hidden input carries `name` (and `required`) so forms that read FormData keep working.
 */
type Opt = { value: string; label: string; disabled?: boolean; group?: string };

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "defaultValue"> & {
  value?: string | number | readonly string[];
  defaultValue?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
};

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as any).children);
  return "";
}

function collect(children: React.ReactNode, group?: string, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const p = child.props as any;
    if (child.type === "option") {
      const label = textOf(p.children);
      out.push({ value: p.value !== undefined ? String(p.value) : label, label, disabled: Boolean(p.disabled), group });
    } else if (child.type === "optgroup") {
      collect(p.children, p.label, out);
    } else if (child.type === React.Fragment) {
      collect(p.children, group, out);
    }
  });
  return out;
}

export function AppSelect({ value, defaultValue, onChange, children, className = "", disabled, required, id, name, style, title, ...rest }: Props) {
  const options = useMemo(() => collect(children), [children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState<string>(defaultValue !== undefined ? String(defaultValue) : options[0]?.value ?? "");
  const current = controlled ? String(value) : inner;
  const chosen = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; max: number; sheet: boolean; title: string } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const emit = useCallback(
    (v: string) => {
      if (!controlled) setInner(v);
      if (onChange && v !== current) {
        const target = { value: v, name: name || "", id: id || "" } as unknown as HTMLSelectElement;
        onChange({ target, currentTarget: target, type: "change", preventDefault() {}, stopPropagation() {} } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }
    },
    [controlled, current, id, name, onChange]
  );

  const place = useCallback(() => {
    const el = btn.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    // Phones and tablets: the choices open as a sheet from the bottom (big rows, the field's name on top).
    const sheet = window.innerWidth < 1024;
    const labelText = (() => {
      const own = (rest as any)["aria-label"];
      if (own) return String(own);
      if (id) {
        const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (l?.textContent) return l.textContent.trim();
      }
      const near = el.parentElement?.querySelector("label") || el.parentElement?.parentElement?.querySelector("label");
      return near?.textContent?.replace(/\*/g, "").trim() || "Choose";
    })();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 168)), top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 180), up, max: Math.max(160, Math.min(320, up ? above : below)), sheet, title: labelText });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    const away = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || list.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (list.current && list.current.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("touchstart", away, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("touchstart", away, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const step = (from: number, dir: 1 | -1) => {
    if (enabled.length === 0) return from;
    const k = enabled.indexOf(from);
    if (k < 0) return dir > 0 ? enabled[0] : enabled[enabled.length - 1];
    return enabled[Math.min(enabled.length - 1, Math.max(0, k + dir))];
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    emit(o.value);
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const idx = open ? active : Math.max(0, options.findIndex((o) => o.value === current));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = step(idx, e.key === "ArrowDown" ? 1 : -1);
      if (open) setActive(n);
      else if (options[n]) emit(options[n].value);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const n = e.key === "Home" ? enabled[0] : enabled[enabled.length - 1];
      if (n === undefined) return;
      if (open) setActive(n);
      else emit(options[n].value);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) choose(active);
      else setOpen(true);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab" && open) {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const start = typed.current.text.length > 1 ? idx : idx + 1;
      for (let k = 0; k < options.length; k++) {
        const i = (start + k) % options.length;
        if (!options[i].disabled && options[i].label.toLowerCase().startsWith(typed.current.text)) {
          if (open) setActive(i);
          else emit(options[i].value);
          break;
        }
      }
    }
  };

  // The field keeps the select's classes (size, border, padding); the arrow sits inside on the right.
  return (
    <>
      <button
        ref={btn}
        type="button"
        id={id}
        title={title}
        style={style}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-required={required || undefined}
        aria-label={(rest as any)["aria-label"]}
        aria-labelledby={(rest as any)["aria-labelledby"]}
        aria-describedby={(rest as any)["aria-describedby"]}
        aria-invalid={(rest as any)["aria-invalid"]}
        data-app-select=""
        data-value={current}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
        onBlur={(rest as any).onBlur}
        onFocus={(rest as any).onFocus}
        className={`rn-app-select relative inline-flex items-center text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${className} !pr-9`}
      >
        <span className={`block min-w-0 flex-1 truncate ${chosen ? "" : "opacity-60"}`}>{chosen?.label ?? ""}</span>
        <ChevronDown aria-hidden className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open &&
        pos?.sheet &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="m-sheet-root rn-select-sheet" role="presentation">
            <button type="button" aria-label="Close" className="m-sheet-scrim" onClick={() => setOpen(false)} />
            <div className="m-sheet" role="dialog" aria-label={pos.title}>
              <span className="m-sheet-grip" aria-hidden />
              <div className="m-sheet-head">
                <h2 className="m-sheet-title">{pos.title}</h2>
              </div>
              <ul ref={list} id={listId} role="listbox" aria-label={pos.title} className="m-sheet-body !gap-0 !pt-0">
                <li role="presentation" className="m-group !overflow-visible">
                  <ul role="presentation">
                    {options.map((o, i) => {
                      const on = o.value === current;
                      const header = o.group && (i === 0 || options[i - 1].group !== o.group);
                      return (
                        <React.Fragment key={`${o.group || ""}:${o.value}:${i}`}>
                          {header && <li role="presentation" className="m-day px-4 pt-3 pb-1">{o.group}</li>}
                          <li
                            role="option"
                            aria-selected={on}
                            aria-disabled={o.disabled || undefined}
                            data-i={i}
                            onClick={() => choose(i)}
                            className={`m-option ${on ? "is-on" : ""} ${o.disabled ? "opacity-40" : ""}`}
                          >
                            <span className="min-w-0 flex-1">{o.label || " "}</span>
                            {on && <Check className="w-5 h-5 shrink-0 text-[var(--rn-accent,#1E3A2B)]" aria-hidden />}
                          </li>
                        </React.Fragment>
                      );
                    })}
                  </ul>
                </li>
              </ul>
            </div>
          </div>,
          document.querySelector(".rn-app") ?? document.body
        )}
      {open &&
        pos &&
        !pos.sheet &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label={(rest as any)["aria-label"] || chosen?.label}
            className="rn-app-select-list fixed z-[200] overflow-y-auto overscroll-contain rounded-2xl bg-white border border-[#E6E0D6] shadow-[0_18px_44px_-12px_rgba(40,25,15,0.35)] p-1.5 text-[14px] text-[#1F2320]"
            // As wide as its options (at least 160px, never past the screen edge), starting under the
            // field: no empty band to the right of short choices in a wide field.
            style={{ left: pos.left, width: "max-content", minWidth: Math.min(160, pos.width), maxWidth: Math.min(440, window.innerWidth - pos.left - 8), maxHeight: pos.max, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          >
            {options.map((o, i) => {
              const on = o.value === current;
              const header = o.group && (i === 0 || options[i - 1].group !== o.group);
              return (
                <React.Fragment key={`${o.group || ""}:${o.value}:${i}`}>
                  {header && <li role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#7A6F66]">{o.group}</li>}
                  <li
                    role="option"
                    aria-selected={on}
                    aria-disabled={o.disabled || undefined}
                    data-i={i}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(i)}
                    className={`min-h-[40px] pl-2.5 pr-4 py-2 rounded-xl flex items-center gap-2 ${
                      o.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
                    } ${on ? "bg-[var(--rn-accent-tint,#F6EEE4)] font-semibold text-[var(--rn-ink,#1F2320)]" : i === active ? "bg-[#F4F0E8]" : ""}`}
                  >
                    {/* The tick sits before the label (every row keeps its place), so nothing floats at the far right. */}
                    <span className="w-4 shrink-0 flex items-center" aria-hidden>
                      {on && <Check className="w-4 h-4 text-[var(--rn-accent,#B4461A)]" />}
                    </span>
                    <span className="min-w-0">{o.label || " "}</span>
                  </li>
                </React.Fragment>
              );
            })}
          </ul>,
          document.body
        )}
    </>
  );
}
