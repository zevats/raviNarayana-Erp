import React from "react";

/**
 * Ravinarayan mark: a sun rising behind the guesthouse roof, after the logo on the public
 * website, redrawn as a simple geometric icon that stays crisp from 24 px up.
 * `tone` picks the palette: "orange" (delivery app) or "forest" (management portal);
 * `variant="light"` draws it for dark backgrounds.
 */
export function BrandMark({ size = 40, tone = "orange", variant = "solid", className = "" }: { size?: number; tone?: "orange" | "forest"; variant?: "solid" | "light"; className?: string }) {
  const p =
    tone === "orange"
      ? { tile: "#C9501C", sun: "#FFD9A8", rays: "#FFE9CC", roof: "#FFFFFF", door: "#C9501C" }
      : { tile: "#263B2D", sun: "#C89F6B", rays: "#E7CFA6", roof: "#FBF9F3", door: "#263B2D" };
  const light = variant === "light";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Ravinarayan" className={className}>
      <rect x="0" y="0" width="48" height="48" rx="14" fill={light ? "rgba(255,255,255,0.10)" : p.tile} />
      {/* sun and rays */}
      <circle cx="24" cy="22" r="7" fill={p.sun} />
      <g stroke={p.rays} strokeWidth="2.2" strokeLinecap="round">
        <line x1="24" y1="9" x2="24" y2="12.5" />
        <line x1="14.5" y1="13" x2="16.8" y2="15.4" />
        <line x1="33.5" y1="13" x2="31.2" y2="15.4" />
        <line x1="10.5" y1="22" x2="13.8" y2="22" />
        <line x1="37.5" y1="22" x2="34.2" y2="22" />
      </g>
      {/* roof and house */}
      <path d="M9 31.5 L24 20.5 L39 31.5" fill="none" stroke={p.roof} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 29.5 V38.5 H34 V29.5 L24 22.4 Z" fill={p.roof} />
      <rect x="21.2" y="31" width="5.6" height="7.5" rx="1.2" fill={light ? "#16221A" : p.door} />
    </svg>
  );
}

/** Profile avatar (person silhouette) used in place of initials across the navbars. */
export function UserAvatar({ size = 36, tone = "orange", className = "" }: { size?: number; tone?: "orange" | "forest" | "dark"; className?: string }) {
  const p =
    tone === "orange"
      ? { bg: "#FCE9DD", fg: "#C9501C" }
      : tone === "forest"
        ? { bg: "#DCE5D7", fg: "#263B2D" }
        : { bg: "#263B2D", fg: "#C89F6B" };
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Profile" className={`rounded-full shrink-0 ${className}`}>
      <circle cx="20" cy="20" r="20" fill={p.bg} />
      <circle cx="20" cy="15.5" r="6.5" fill={p.fg} />
      <path d="M7.5 34.5 C9.5 27.5 14.2 24.5 20 24.5 C25.8 24.5 30.5 27.5 32.5 34.5 A20 20 0 0 1 7.5 34.5 Z" fill={p.fg} />
    </svg>
  );
}
