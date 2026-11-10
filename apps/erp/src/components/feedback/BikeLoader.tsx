import React from "react";

/**
 * The app's loading indicator: a delivery scooter riding in place (wheels turn, the road moves
 * under it, the body gently bobs). Used for every loading screen and busy button instead of a
 * spinner. `tone` follows the audience (orange: delivery app, forest: management portal; "auto"
 * reads CSS variables, forest by default and orange inside the delivery app's shell);
 * `inline` draws a small one for buttons. With reduced motion it stands still.
 */
type Tone = "auto" | "orange" | "forest" | "light";

const PALETTE: Record<Tone, { body: string; box: string; boxLine: string; ink: string; road: string; light: string }> = {
  auto: { body: "var(--rn-bike-body, #263B2D)", box: "var(--rn-bike-box, #EADFC9)", boxLine: "var(--rn-bike-line, #B58A57)", ink: "#1F2320", road: "#D8CFC0", light: "var(--rn-bike-light, #C89F6B)" },
  orange: { body: "#C9501C", box: "#FCE9DD", boxLine: "#C9501C", ink: "#1F2320", road: "#D8CFC0", light: "#F2B33D" },
  forest: { body: "#263B2D", box: "#EADFC9", boxLine: "#B58A57", ink: "#1F2320", road: "#D8CFC0", light: "#C89F6B" },
  light: { body: "#FFFFFF", box: "rgba(255,255,255,0.25)", boxLine: "#FFFFFF", ink: "#FFFFFF", road: "rgba(255,255,255,0.45)", light: "#FFE9CC" },
};

function Wheel({ cx, cy, ink }: { cx: number; cy: number; ink: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="9" strokeWidth="3.5" style={{ fill: "none", stroke: ink }} />
      <g className="rn-bike-wheel" style={{ stroke: ink }} strokeWidth="1.4" strokeLinecap="round">
        <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} />
        <line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} />
        <circle cx={cx} cy={cy} r="2" style={{ fill: ink, stroke: "none" }} />
      </g>
    </g>
  );
}

export function BikeGraphic({ tone = "auto", width = 96 }: { tone?: Tone; width?: number }) {
  const p = PALETTE[tone];
  // Colours go through style (not presentation attributes) so CSS variables resolve everywhere.
  return (
    <svg width={width} height={(width * 64) / 112} viewBox="0 0 112 64" aria-hidden="true" className="rn-bike overflow-visible">
      <g className="rn-bike-wind" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: p.road }}>
        <line x1="2" y1="22" x2="11" y2="22" />
        <line x1="0" y1="30" x2="7" y2="30" />
      </g>
      <line className="rn-bike-road" x1="4" y1="61" x2="108" y2="61" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="12 10" style={{ stroke: p.road }} />
      <Wheel cx={30} cy={50} ink={p.ink} />
      <Wheel cx={86} cy={50} ink={p.ink} />
      <g className="rn-bike-body">
        {/* delivery box */}
        <rect x="14" y="13" width="22" height="18" rx="3.5" strokeWidth="2.4" style={{ fill: p.box, stroke: p.boxLine }} />
        <line x1="14" y1="19" x2="36" y2="19" strokeWidth="2" style={{ stroke: p.boxLine }} />
        {/* seat and body */}
        <rect x="35" y="27" width="22" height="5" rx="2.5" style={{ fill: p.ink }} />
        <path d="M21 45 C21 37 27 33 35 33 L58 33 C62 33 64 36 66 40 L71 47 L21 47 Z" style={{ fill: p.body }} />
        {/* steering column, handlebar, light */}
        <line x1="69" y1="46" x2="78" y2="19" strokeWidth="5" strokeLinecap="round" style={{ stroke: p.body }} />
        <line x1="74" y1="18" x2="83" y2="16" strokeWidth="3.4" strokeLinecap="round" style={{ stroke: p.ink }} />
        <circle cx="81" cy="26" r="2.4" style={{ fill: p.light }} />
        {/* front fender */}
        <path d="M76 44 A11 11 0 0 1 97 44" strokeWidth="3" strokeLinecap="round" style={{ fill: "none", stroke: p.body }} />
      </g>
    </svg>
  );
}


/**
 * Manager ERP sections other than Orders and Delivery: a small house inside a turning ring, its
 * window glowing softly (a quiet, steady loader). Which graphic shows is decided by CSS
 * (styles/glass.css): the house inside the manager shell's green sections, the scooter everywhere
 * else, so the delivery app and Orders/Delivery keep the scooter.
 */
/**
 * The house-and-tiffin logo drawn stroke by stroke (swoosh, roof, chimney, walls, window, bed, the
 * covered dish and its steam), quickly and in sequence, then it holds and fades and draws again.
 */
const HOUSE_STROKES: Array<{ d: string; c: "g" | "o"; w?: number }> = [
  { d: "M24 78 C18 98 42 110 76 104", c: "o", w: 5 },
  { d: "M18 58 L60 24 L102 58", c: "g", w: 7 },
  { d: "M26 48 Q44 26 62 14", c: "o", w: 3.5 },
  { d: "M82 42 V30 H91 V50", c: "g", w: 5 },
  { d: "M30 62 V98", c: "g", w: 5 },
  { d: "M51 40 h8 v8 h-8 Z M61 40 h8 v8 h-8 Z M51 50 h8 v8 h-8 Z M61 50 h8 v8 h-8 Z", c: "g", w: 2.6 },
  { d: "M38 70 V98 M38 84 H64 M40 75 Q47 68 54 75", c: "g", w: 4.5 },
  { d: "M64 92 A19 17 0 0 1 102 92 M83 75 V71 M60 97 H106", c: "o", w: 4.5 },
  { d: "M75 66 q-3 -4 0 -8 q3 -4 0 -8 M83 64 q-3 -4 0 -8 q3 -4 0 -8 M91 66 q-3 -4 0 -8 q3 -4 0 -8", c: "o", w: 2.6 },
];

export function HouseGraphic({ width = 96 }: { width?: number }) {
  const size = Math.round(width * 0.72);
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" className="rn-house rn-draw overflow-visible">
      {HOUSE_STROKES.map((p, i) => (
        <path
          key={i}
          d={p.d}
          pathLength={1}
          strokeWidth={p.w ?? 5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ fill: "none", stroke: p.c === "g" ? "var(--rn-logo-green, #1E6B2A)" : "var(--rn-logo-orange, #EE7A1F)", ["--i" as any]: i }}
        />
      ))}
    </svg>
  );
}

export function BikeLoader({
  label = "Loading…",
  tone = "auto",
  inline = false,
  className = "",
  size = "md",
}: {
  label?: string | null;
  tone?: Tone;
  inline?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  if (inline) {
    return (
      <span role="status" aria-label={label || "Loading"} className={`inline-flex items-center ${className}`}>
        <BikeGraphic tone={tone} width={30} />
        {tone === "auto" && <HouseGraphic width={30} />}
      </span>
    );
  }
  const width = size === "lg" ? 128 : size === "sm" ? 72 : 96;
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}>
      <BikeGraphic tone={tone} width={width} />
      {tone === "auto" && <HouseGraphic width={width} />}
      {label && <p className={`text-[13px] font-semibold ${tone === "light" ? "text-white/80" : "text-[#5A6C5E]"}`}>{label}</p>}
    </div>
  );
}
