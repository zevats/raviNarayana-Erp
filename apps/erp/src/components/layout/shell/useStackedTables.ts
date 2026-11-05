"use client";

import { useEffect, type RefObject } from "react";

/**
 * No page may scroll sideways. Where a table is wider than the space it has (phones, tablets and
 * the expanded-sidebar laptop width), glass.css lays each row out as a small card: one line per
 * column, with the column's name beside the value. This hook copies each header's text onto the
 * cells below it (data-label) so those names can be shown, for every table under `root`,
 * including tables that appear later (tabs, dialogs, filtered rows).
 */
export function useStackedTables(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    // Tables touched since the last frame; null means "all" (first run).
    let pending: Set<HTMLTableElement> | null = null;

    const labelTable = (table: HTMLTableElement) => {
      const heads = table.tHead?.rows[table.tHead.rows.length - 1]?.cells;
      if (!heads || heads.length === 0) return;
      const names: string[] = [];
      for (const th of Array.from(heads)) {
        const text = (th.textContent || "").replace(/\s+/g, " ").trim();
        for (let i = 0; i < (th.colSpan || 1); i++) names.push(text);
      }
      for (const body of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
        for (const row of Array.from(body.rows)) {
          let col = 0;
          for (const cell of Array.from(row.cells)) {
            const name = cell.colSpan > 1 ? "" : names[col] ?? "";
            if (cell.getAttribute("data-label") !== name) cell.setAttribute("data-label", name);
            col += cell.colSpan || 1;
          }
        }
      }
    };

    const label = () => {
      frame = 0;
      const tables = pending ?? new Set(Array.from(el.querySelectorAll("table")));
      pending = new Set();
      tables.forEach((t) => { if (t.isConnected) labelTable(t); });
    };

    // Only added/removed nodes are watched, so setting data-label never re-triggers the observer.
    // Only the tables a change touched are relabelled (typing or a list refresh elsewhere costs nothing).
    const observer = new MutationObserver((records) => {
      const set = (pending ??= new Set());
      for (const m of records) {
        const host = (m.target as Element).closest?.("table");
        if (host) set.add(host as HTMLTableElement);
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n instanceof HTMLTableElement) set.add(n);
          else n.querySelectorAll("table").forEach((t) => set.add(t));
        });
      }
      if (set.size && !frame) frame = requestAnimationFrame(label);
    });
    observer.observe(el, { childList: true, subtree: true });
    label();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);
}
