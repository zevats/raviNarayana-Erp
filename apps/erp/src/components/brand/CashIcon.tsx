import React from "react";

/**
 * "Cash with you" illustration: two rupee notes, the front one with a drawn ₹ and an inner border,
 * and a coin — flat shapes in the delivery app's orange, sized for a 56 px tile.
 */
export function CashIcon({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" className={className}>
      <rect width="56" height="56" rx="16" fill="#FCE9DD" />
      {/* back note, slightly turned */}
      <rect x="11" y="13" width="32" height="20" rx="3.5" fill="#F0B28F" transform="rotate(-9 27 23)" />
      {/* front note */}
      <rect x="8" y="19" width="34" height="21" rx="3.5" fill="#C9501C" />
      <rect x="11" y="22" width="28" height="15" rx="2" fill="none" stroke="#FCE9DD" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle cx="25" cy="29.5" r="5.6" fill="#FCE9DD" />
      {/* ₹ */}
      <path d="M22.4 26.6h5.2M22.4 28.6h5.2M22.4 26.6c3.6 0 3.6 4.1 0 4.1l3.9 2.7" fill="none" stroke="#C9501C" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      {/* coin */}
      <circle cx="41" cy="39" r="7" fill="#E9A23B" stroke="#FCE9DD" strokeWidth="2" />
      <circle cx="41" cy="39" r="4.2" fill="none" stroke="#B87512" strokeOpacity="0.55" strokeWidth="1.1" />
    </svg>
  );
}
