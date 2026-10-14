"use client";

import React from "react";
import {
  Wifi,
  Droplets,
  ShieldCheck,
  UtensilsCrossed,
  Shirt,
  Users,
  Sparkles,
} from "lucide-react";
import { siteConfig } from "@/data/siteConfig";

export const AmenitiesSection: React.FC = () => {
  const iconMap: Record<string, React.ReactNode> = {
    Wifi: <Wifi className="w-6 h-6" />,
    Droplets: <Droplets className="w-6 h-6" />,
    ShieldCheck: <ShieldCheck className="w-6 h-6" />,
    UtensilsCrossed: <UtensilsCrossed className="w-6 h-6" />,
    Shirt: <Shirt className="w-6 h-6" />,
    Users: <Users className="w-6 h-6" />,
  };

  return (
    <section id="amenities" className="relative py-24 sm:py-32 bg-ivory text-charcoal overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-1/2 left-0 -translate-y-1/2 w-72 h-72 bg-sage/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-0 w-80 h-80 bg-brass/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 text-forest text-xs font-semibold tracking-widest uppercase mb-3">
            <span className="w-8 h-px bg-brass" />
            <span>03 &bull; Everyday Comfort</span>
            <span className="w-8 h-px bg-brass" />
          </div>
          <h2 className="headline-display font-serif font-bold text-forest tracking-tight">
            Curated Living Amenities
          </h2>
          <p className="mt-4 text-muted text-base sm:text-lg leading-relaxed">
            Essential comforts provided across all accommodation tiers to support a productive, peaceful, and worry-free stay in Haryana.
          </p>
        </div>

        {/* 6 Grid Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
          {siteConfig.amenities.map((item, idx) => {
            return (
              <div
                key={item.id}
                className="group relative rounded-2xl sm:rounded-3xl bg-white border border-sage/20 p-8 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between"
              >
                {/* Top Row: Icon & Badge */}
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div className="w-14 h-14 rounded-2xl bg-forest/5 text-forest group-hover:bg-forest group-hover:text-ivory transition-colors duration-300 flex items-center justify-center border border-sage/20">
                      {iconMap[item.icon]}
                    </div>
                    <span className="px-3 py-1 rounded-full bg-cream text-forest text-[11px] font-mono uppercase tracking-wider font-medium border border-sage/20">
                      {item.badge}
                    </span>
                  </div>

                  {/* Amenity Info */}
                  <h3 className="font-serif text-xl sm:text-2xl font-bold text-forest mb-1.5 group-hover:text-brass transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-xs uppercase tracking-wider text-brass font-mono mb-3">
                    {item.subtitle}
                  </p>
                  <p className="text-sm text-muted leading-relaxed">
                    {item.description}
                  </p>
                </div>

                {/* Subtle Bottom Accent Line */}
                <div className="mt-6 pt-4 border-t border-charcoal/5 flex items-center justify-between text-[11px] text-sage font-mono">
                  <span>Standard Feature</span>
                  <span className="text-forest font-bold">0{idx + 1}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
