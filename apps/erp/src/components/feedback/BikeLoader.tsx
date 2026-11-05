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
 * Manager ERP sections other than Orders and Delivery: a house being built brick by brick (the
 * bricks are laid row by row, then the roof and door close it), looping. Which graphic shows is
 * decided by CSS (styles/glass.css): the house inside the manager shell's green sections, the
 * scooter everywhere else, so the delivery app and Orders/Delivery keep the scooter.
 */
export function HouseGraphic({ width = 96 }: { width?: number }) {
  const rows = [0, 1, 2, 3];
  return (
    <svg width={width} height={(width * 64) / 112} viewBox="0 0 112 64" aria-hidden="true" className="rn-house overflow-visible">
      <line x1="18" y1="61" x2="94" y2="61" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: "#D8CFC0" }} />
      {rows.flatMap((r) => {
        // Staggered courses: four bricks, then three centred over the joints.
        const count = r % 2 ? 3 : 4;
        const start = r % 2 ? 37.25 : 31;
        return Array.from({ length: count }, (_, c) => (
          <rect
            key={`${r}-${c}`}
            className="rn-house-brick"
            style={{ animationDelay: `${(r * 4 + c) * 90}ms`, fill: "var(--rn-house-wall, #8E9F89)" }}
            x={start + c * 12.5}
            y={52 - r * 8}
            width="11.5"
            height="6.5"
            rx="1.4"
          />
        ));
      })}
      <path className="rn-house-roof" d="M26 30 L56 9 L86 30" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" style={{ fill: "none", stroke: "var(--rn-house-roof, #263B2D)" }} />
      <rect className="rn-house-door" x="51.5" y="47" width="9" height="13" rx="1.6" style={{ fill: "var(--rn-house-roof, #263B2D)" }} />
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
