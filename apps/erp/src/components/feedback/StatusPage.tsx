"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Home, RotateCcw, Copy, Check } from "lucide-react";
import { RnLogo } from "@/components/brand/RnLogo";
import { useFillHeight } from "./FullPageLoader";

/**
 * Full-page status (404, something went wrong, offline): one calm glass card in the app's own
 * colours, the Ravinarayan logo, a short label, a plain title and sentence, and clear ways out.
 * Used by not-found and the error boundaries. Colours fall back to the forest palette where the
 * section variables are not loaded (global error page).
 */
export function StatusPage({
  code,
  title,
  message,
  onRetry,
  reference,
  showBack = true,
}: {
  code: string;
  title: string;
  message: string;
  onRetry?: () => void;
  reference?: string;
  showBack?: boolean;
}) {
  const fill = useFillHeight<HTMLDivElement>();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the reference stays visible to read out */
    }
  };
  const ink = "var(--rn-ink, #1A2E20)";
  const ink2 = "var(--rn-ink-2, #3E4F42)";
  const ink3 = "var(--rn-ink-3, #6E7F70)";
  const accent = "var(--rn-accent, #1A2E20)";
  const tint = "var(--rn-accent-tint, #EEF3EA)";
  const line = "var(--rn-line, rgba(26,46,32,0.10))";

  return (
    <div ref={fill.ref} style={fill.style} className="min-h-[70vh] flex items-center justify-center px-4 py-10 font-sans">
      <section
        className="relative w-full max-w-[460px] overflow-hidden rounded-[32px] px-6 py-9 sm:px-10 sm:py-11 text-center"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.78) 100%)",
          border: `1px solid ${line}`,
          boxShadow: "0 1px 2px rgba(26,46,32,0.05), 0 40px 80px -40px rgba(26,46,32,0.35)",
          backdropFilter: "blur(18px)",
        }}
        aria-labelledby="rn-status-title"
      >
        {/* soft glow behind the logo */}
        <span aria-hidden className="pointer-events-none absolute left-1/2 -top-24 h-56 w-56 -translate-x-1/2 rounded-full opacity-70 blur-2xl" style={{ background: tint }} />

        <div className="relative mx-auto grid h-[104px] w-[104px] place-items-center rounded-full" style={{ background: tint }}>
          <RnLogo brand="standard" size={76} title="" />
        </div>

        <p className="relative mt-6 inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={{ background: tint, color: accent }}>
          {code}
        </p>
        <h1 id="rn-status-title" className="relative mt-3 text-[26px] sm:text-[30px] font-semibold leading-tight tracking-[-0.02em]" style={{ color: ink, fontFamily: "var(--font-rn-display), var(--font-sans)" }}>
          {title}
        </h1>
        <p className="relative mx-auto mt-3 max-w-[340px] text-[15px] leading-relaxed" style={{ color: ink2 }}>
          {message}
        </p>

        <div className="relative mt-8 flex flex-col gap-2.5">
          {onRetry && (
            <button type="button" onClick={onRetry} className="rn-press h-12 w-full rounded-full font-semibold text-white inline-flex items-center justify-center gap-2 transition-opacity hover:opacity-90" style={{ background: accent }}>
              <RotateCcw className="w-4 h-4" /> Try again
            </button>
          )}
          <div className={`grid gap-2.5 ${showBack ? "grid-cols-2" : "grid-cols-1"}`}>
            <Link
              href="/"
              className={`rn-press h-12 rounded-full font-semibold inline-flex items-center justify-center gap-2 transition-colors ${onRetry ? "" : "text-white"}`}
              style={onRetry ? { background: "rgba(255,255,255,0.9)", border: `1px solid ${line}`, color: ink } : { background: accent }}
            >
              <Home className="w-4 h-4" /> Home
            </Link>
            {showBack && (
              <button
                type="button"
                onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/"))}
                className="rn-press h-12 rounded-full font-semibold inline-flex items-center justify-center gap-2"
                style={{ background: "rgba(255,255,255,0.9)", border: `1px solid ${line}`, color: ink }}
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
          </div>
        </div>

        {reference && (
          <div className="relative mt-7 flex items-center justify-center gap-2 text-[12px]" style={{ color: ink3 }}>
            <span>Reference</span>
            <code className="rounded-md px-2 py-0.5 font-mono text-[11.5px]" style={{ background: tint, color: ink2 }}>{reference}</code>
            <button type="button" onClick={copy} aria-label="Copy the reference" className="grid h-8 w-8 place-items-center rounded-full hover:bg-black/[0.04]">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
