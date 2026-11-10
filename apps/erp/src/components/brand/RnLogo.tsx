import React from "react";

/**
 * Ravinarayan brand. Two editions:
 *   - "standard": the house with a bed and a served dish (owner and managers)
 *   - "delivery": the scooter rider with the food box (delivery app)
 * RnMark is the earlier drawn "R" monogram, kept because the Android launcher and splash icons use
 * the same geometry.
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

/**
 * The logo pictures (transparent PNGs, no tile behind them): the scooter rider for the delivery app,
 * the house with a bed and a served dish for everyone else. `onColor` picks the edition drawn for
 * the brand's own colour (orange sign-in header, green download page): there the part that would
 * vanish into the background (orange or green) is drawn in cream.
 */
export const RN_LOGO_SRC: Record<RnBrand, string> = {
  standard: "/brand/logo-home.png",
  delivery: "/brand/logo-delivery.png",
};
const RN_LOGO_ON_COLOR: Record<RnBrand, string> = {
  standard: "/brand/logo-home-on-green.png",
  delivery: "/brand/logo-delivery-on-orange.png",
};

export function RnLogo({ brand = "standard", size = 56, className = "", title = "Ravinarayan", onColor = false }: { brand?: RnBrand; size?: number; className?: string; title?: string; onColor?: boolean; outline?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={(onColor ? RN_LOGO_ON_COLOR : RN_LOGO_SRC)[brand]}
      alt={title}
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      className={`inline-block shrink-0 object-contain select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
