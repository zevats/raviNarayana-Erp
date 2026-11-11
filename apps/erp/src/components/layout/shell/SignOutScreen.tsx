"use client";

import React from "react";
import { createPortal } from "react-dom";
import { RnLogo } from "@/components/brand/RnLogo";

/** Signing out: the page softly blurs, the logo and a thin moving line show it is on its way. */
export function SignOutScreen() {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="rn-signout" role="status" aria-live="polite" aria-label="Signing out">
      <div className="rn-signout-inner">
        <span className="rn-signout-logo">
          <RnLogo size={68} title="" />
        </span>
        <p className="rn-signout-title">Signing out</p>
        <span className="rn-signout-line" aria-hidden />
      </div>
    </div>,
    document.body
  );
}
