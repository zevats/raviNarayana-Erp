import React from "react";

/**
 * "Cash with you" illustration: two rupee notes, the front one with a drawn ₹ and an inner border,
 * flat shapes in the delivery app's orange, sized for a 56 px tile.
 */
export function CashIcon({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" className={className}>
      <rect width="56" height="56" rx="16" fill="#FCE9DD" />
      {/* back note, slightly turned */}
      <rect x="12" y="14" width="32" height="20" rx="3.5" fill="#F0B28F" transform="rotate(-9 28 24)" />
      {/* front note */}
      <rect x="11" y="20" width="34" height="21" rx="3.5" fill="#C9501C" />
      <rect x="14" y="23" width="28" height="15" rx="2" fill="none" stroke="#FCE9DD" strokeOpacity="0.55" strokeWidth="1.2" />
      <circle cx="28" cy="30.5" r="5.6" fill="#FCE9DD" />
      {/* ₹ */}
      <path d="M25.4 27.6h5.2M25.4 29.6h5.2M25.4 27.6c3.6 0 3.6 4.1 0 4.1l3.9 2.7" fill="none" stroke="#C9501C" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
