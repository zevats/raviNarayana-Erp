"use client";

import React from "react";
import {
  Shield,
  Sparkles,
  Droplets,
  Wifi,
  UtensilsCrossed,
  HeartHandshake,
  MapPin,
} from "lucide-react";

export interface SeparatorItem {
  text: string;
  icon?: "shield" | "sparkles" | "water" | "wifi" | "dining" | "care" | "pin" | "crest";
}

interface SectionSeparatorProps {
  theme?: "forest" | "dark" | "botanical" | "brass";
  direction?: "left" | "right";
  angle?: number;
  className?: string;
  items?: SeparatorItem[];
  topColor?: string;
  bottomColor?: string;
}

const defaultItems: SeparatorItem[] = [
  { text: "PEACEFUL SANCTUARY", icon: "crest" },
  { text: "MET CITY &bull; YAKUBPUR &bull; JHAJJAR", icon: "pin" },
  { text: "24/7 CCTV SECURITY", icon: "shield" },
  { text: "PURE RO PURIFIED WATER", icon: "water" },
  { text: "FRESH DAILY TIFFIN MEALS", icon: "dining" },
  { text: "HIGH-SPEED FIBER WI-FI", icon: "wifi" },
  { text: "QUIET RESTFUL LIVING", icon: "sparkles" },
  { text: "ATTENTIVE OWNER CARE", icon: "care" },
];

export const SectionSeparator: React.FC<SectionSeparatorProps> = ({
  theme = "forest",
  angle = -1.5,
  className = "",
  items = defaultItems,
  topColor = "transparent",
  bottomColor = "transparent",
}) => {
  const themeStyles = {
    forest: {
      wrap: "bg-[#141F18] text-white border-y-[1.5px] border-[#B58A57]/70 shadow-[0_6px_20px_rgba(0,0,0,0.45)]",
      badge: "bg-black/60 border-[#B58A57]/60 text-amber-300",
      accent: "text-amber-400",
      text: "text-white/95",
    },
    dark: {
      wrap: "bg-[#0E1511] text-white border-y-[1.5px] border-emerald-500/50 shadow-[0_6px_20px_rgba(0,0,0,0.5)]",
      badge: "bg-white/10 border-white/20 text-emerald-400",
      accent: "text-emerald-400",
      text: "text-white/90",
    },
    botanical: {
      wrap: "bg-[#263B2D] text-white border-y-[1.5px] border-[#A8B9A1]/60 shadow-[0_6px_20px_rgba(0,0,0,0.4)]",
      badge: "bg-black/40 border-white/30 text-white",
      accent: "text-[#DCE5D7]",
      text: "text-white",
    },
    brass: {
      wrap: "bg-[#8C6638] text-white border-y-[1.5px] border-[#E3DCB8]/60 shadow-[0_6px_20px_rgba(0,0,0,0.4)]",
      badge: "bg-black/40 border-white/30 text-amber-200",
      accent: "text-amber-200",
      text: "text-white font-bold",
    },
  }[theme];

  const renderIcon = (type?: SeparatorItem["icon"]) => {
    switch (type) {
      case "shield":
        return <Shield className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "water":
        return <Droplets className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "wifi":
        return <Wifi className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "dining":
        return <UtensilsCrossed className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "care":
        return <HeartHandshake className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "pin":
        return <MapPin className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "sparkles":
        return <Sparkles className="w-2.5 h-2.5 sm:w-3 sm:h-3" />;
      case "crest":
      default:
        return (
          <span className="font-serif font-black text-[9px] sm:text-[10px] tracking-normal leading-none text-amber-300">
            R
          </span>
        );
    }
  };

  // Calculate polygon split points according to angle so background perfectly matches sections above & below
  // For negative angle (e.g. -1.5): line goes from (0, 47) to (1000, 53)
  // For positive angle (e.g. 1.5): line goes from (0, 53) to (1000, 47)
  const isNegative = angle < 0;
  const pYLeft = isNegative ? 46 : 54;
  const pYRight = isNegative ? 54 : 46;

  return (
    <div
      className={`relative w-full h-12 sm:h-14 overflow-hidden select-none z-30 ${className}`}
      aria-hidden="true"
    >
      {/* 
        Precision Angled Split Background:
        Fills the top wedge with topColor (e.g. dark hero) and bottom wedge with bottomColor (e.g. light services).
        This guarantees ZERO white gaps, zero wedges, and zero seam breaks.
      */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
      >
        <polygon
          points={`0,0 1000,0 1000,${pYRight} 0,${pYLeft}`}
          fill={topColor}
        />
        <polygon
          points={`0,${pYLeft} 1000,${pYRight} 1000,100 0,100`}
          fill={bottomColor}
        />
      </svg>

      {/* 
        Static Angled Ribbon Track:
        Completely static (no movement) as requested, perfectly centered and rotated to match the boundary.
      */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[125%] pointer-events-auto"
        style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }}
      >
        <div
          className={`w-full h-8 sm:h-9 flex items-center justify-center overflow-hidden ${themeStyles.wrap}`}
        >
          {/* Static Item Row (No scrolling marquee, fully static) */}
          <div className="flex items-center justify-center gap-3 sm:gap-6 px-4 whitespace-nowrap overflow-hidden">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-2 sm:gap-2.5 shrink-0"
              >
                {/* Circular Stamped Icon Emblem */}
                <div
                  className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 border shadow-xs ${themeStyles.badge}`}
                >
                  {renderIcon(item.icon)}
                </div>

                {/* Sleek Micro-Typography: Tracked Uppercase Monospace */}
                <span
                  className={`text-[9px] sm:text-[10px] font-mono tracking-[0.22em] font-semibold uppercase whitespace-nowrap ${themeStyles.text}`}
                  dangerouslySetInnerHTML={{ __html: item.text }}
                />

                {/* Decorative Geometric Diamond Separator */}
                <span className={`text-[8px] shrink-0 font-mono ${themeStyles.accent}`}>
                  ✦
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
