import React from "react";

/**
 * Ravinarayan monogram. An upright "R" drawn with three strokes on a rounded tile, with the small
 * sun from the Ravinarayan identity. Two editions that share the same letterform:
 *   - "standard": deep green tile, cream R, gold sun (ERP / management)
 *   - "delivery": orange tile, white R, cream sun and three speed lines (delivery app)
 * The geometry is the same as the Android launcher and splash icons (108-unit grid).
 */
export type RnBrand = "standard" | "delivery";

const PALETTE: Record<RnBrand, { tile: string; mark: string; sun: string; speed: string }> = {
  standard: { tile: "#173A29", mark: "#F7F1E3", sun: "#D4A24E", speed: "transparent" },
  delivery: { tile: "#C9501C", mark: "#FFFFFF", sun: "#FFE3C2", speed: "#FFD7BC" },
};

/** Just the "R", sun and (delivery) speed lines — no tile; for placing on any background. */
export function RnMark({ brand = "standard", color, sun, speed }: { brand?: RnBrand; color?: string; sun?: string; speed?: string }) {
  const p = PALETTE[brand];
  return (
    <g>
      {brand === "delivery" && (
        <g stroke={speed || p.speed} strokeWidth="5" strokeLinecap="round">
          <line x1="20" y1="47" x2="31" y2="47" />
          <line x1="24" y1="58" x2="31" y2="58" />
          <line x1="20" y1="69" x2="31" y2="69" />
        </g>
      )}
      <g fill="none" stroke={color || p.mark} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
        <path d="M42 80 V33" />
        <path d="M42 33 H58 a12.5 12.5 0 0 1 0 25 H42" />
        <path d="M55 58 L70 80" />
      </g>
      <circle cx="76" cy="31" r="6" fill={sun || p.sun} />
    </g>
  );
}

export function RnLogo({ brand = "standard", size = 56, className = "", title = "Ravinarayan", outline = false }: { brand?: RnBrand; size?: number; className?: string; title?: string; outline?: boolean }) {
  const p = PALETTE[brand];
  return (
    <svg width={size} height={size} viewBox="0 0 108 108" role="img" aria-label={title} className={className}>
      <rect width="108" height="108" rx="28" fill={p.tile} />
      {/* On a background of its own colour (sign-in header), a fine light edge keeps the tile readable. */}
      {outline && <rect x="1" y="1" width="106" height="106" rx="27" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="2" />}
      <RnMark brand={brand} />
    </svg>
  );
}
