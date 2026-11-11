"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { friendlyError } from "@/lib/friendlyError";

/**
 * Messages that confirm an action or report a problem, shown above everything (pop-ups included)
 * and gone by themselves. Any code can call `toast.ok("…")` / `toast.error("…")`; the shell shows
 * them through <Toaster />.
 */
export interface ToastItem {
  id: number;
  tone: "ok" | "error";
  text: string;
}

type Listener = (t: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 0;
let lastAt = 0;

function emit(tone: ToastItem["tone"], text: string) {
  const clean = friendlyError(String(text || ""), String(text || "")).trim();
  if (!clean) return;
  lastAt = Date.now();
  const item = { id: ++seq, tone, text: clean };
  listeners.forEach((l) => l(item));
}

export const toast = {
  ok: (text: string) => emit("ok", text),
  error: (text: string) => emit("error", text),
  /** When the last message was shown (the automatic feedback uses it to stay quiet). */
  lastAt: () => lastAt,
};

const OK_MS = 4500;
const ERROR_MS = 9000;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    const onToast: Listener = (t) => {
      setItems((prev) => [...prev.filter((p) => p.text !== t.text).slice(-2), t]);
      window.setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== t.id)), t.tone === "error" ? ERROR_MS : OK_MS);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);
  if (!host || items.length === 0) return null;
  return createPortal(
    <div className="rn-toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={`rn-toast ${t.tone === "error" ? "is-error" : "is-ok"}`}>
          {t.tone === "error" ? <AlertCircle aria-hidden /> : <CheckCircle2 aria-hidden />}
          <span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setItems((prev) => prev.filter((p) => p.id !== t.id))}>
            <X aria-hidden />
          </button>
        </div>
      ))}
    </div>,
    host
  );
}
