"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, Home, RotateCcw } from "lucide-react";
import { BikeGraphic } from "./BikeLoader";
import { useFillHeight } from "./FullPageLoader";

/**
 * Full-page status (404, something went wrong): the scooter parked at the roadside, a big code,
 * one plain sentence and clear ways out. Used by not-found and the error boundaries.
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
  return (
    <div ref={fill.ref} style={fill.style} className="min-h-[70vh] flex items-center justify-center px-4 py-10 font-sans text-[#1F2320]">
      <div className="w-full max-w-md text-center">
        <div className="rn-bike-still mx-auto w-fit">
          <BikeGraphic tone="auto" width={132} />
        </div>
        <p className="mt-6 text-[13px] font-bold uppercase tracking-[0.14em] text-[#B58A57]">{code}</p>
        <h1 className="mt-2 text-[28px] sm:text-[32px] font-extrabold tracking-[-0.02em]">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#5A6C5E]">{message}</p>
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          {onRetry && (
            <button type="button" onClick={onRetry} className="rn-press h-12 px-6 rounded-xl bg-[#263B2D] text-white font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#1A2E20]">
              <RotateCcw className="w-4 h-4" /> Try again
            </button>
          )}
          <Link href="/" className={`rn-press h-12 px-6 rounded-xl font-semibold inline-flex items-center justify-center gap-2 ${onRetry ? "bg-[#EFEAE1] text-[#1F2320] hover:bg-[#E6E0D4]" : "bg-[#263B2D] text-white hover:bg-[#1A2E20]"}`}>
            <Home className="w-4 h-4" /> Go to home
          </Link>
          {showBack && (
            <button
              type="button"
              onClick={() => (window.history.length > 1 ? window.history.back() : window.location.assign("/"))}
              className="rn-press h-12 px-6 rounded-xl text-[#3E4540] font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#EFEAE1]"
            >
              <ArrowLeft className="w-4 h-4" /> Go back
            </button>
          )}
        </div>
        {reference && <p className="mt-8 text-[12px] text-[#8E9F89]">Reference: {reference}</p>}
      </div>
    </div>
  );
}
