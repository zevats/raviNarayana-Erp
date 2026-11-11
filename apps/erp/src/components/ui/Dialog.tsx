"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { lockScroll } from "@/lib/scrollLock";

/**
 * The shared dialog: drawn in the shell root (never clipped or offset by a card), backdrop,
 * focus moved inside and returned on close, Escape and backdrop click close it (unless busy),
 * page scroll locked while open. Phones get a bottom sheet with the full width.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => setHost((document.querySelector(".rn-app") as HTMLElement) || document.body), []);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
      (first || panel.current)?.focus({ preventScroll: true });
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      unlock();
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, busy, onClose]);

  if (!open || !host) return null;
  const width = size === "sm" ? "sm:max-w-[420px]" : size === "lg" ? "sm:max-w-[720px]" : "sm:max-w-[540px]";
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 rn-modal-scrim">
      <div className="absolute inset-0 bg-[rgba(18,28,22,0.32)] backdrop-blur-[6px] rn-scrim" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`rn-dialog rn-modal ${size === "lg" ? "rn-modal-wide" : ""} relative w-full ${width} max-h-[94dvh] sm:max-h-[calc(100dvh-2rem)] flex flex-col rounded-t-[26px] sm:rounded-[26px] rn-rise outline-none`}
      >
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 sm:pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="rn-t-section">{title}</h2>
            {description && <p id={descId} className="rn-t-meta mt-1">{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rn-btn rn-btn-sm rn-btn-icon -mr-1 shrink-0">
            <X />
          </button>
        </div>
        {children && <div className="px-5 sm:px-6 py-4 overflow-y-auto overscroll-contain">{children}</div>}
        {footer && <div className="px-5 sm:px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    host
  );
}

/** Yes/no question before an action; `danger` styles the confirm button for destructive actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  error,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="rn-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`rn-btn ${danger ? "rn-btn-danger-solid" : "rn-btn-primary"}`} onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {(children || error) && (
        <div className="space-y-3">
          {children}
          {error && <p role="alert" className="rn-notice rn-notice-bad">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
