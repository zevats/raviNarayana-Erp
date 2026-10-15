"use client";

import React from "react";
import { Wifi, Droplets, ShieldCheck, Shirt } from "lucide-react";

interface Facility {
  title: string;
  tagline: string;
  description: string;
  icon: React.ReactNode;
}

const essentialFacilities: Facility[] = [
  {
    title: "High-Speed Wi-Fi",
    tagline: "Dedicated Fiber Speed",
    description: "Enterprise-grade fiber internet with uninterrupted coverage across all bedrooms and workspaces.",
    icon: <Wifi className="w-5 h-5 text-emerald-400" />,
  },
  {
    title: "RO Purified Water",
    tagline: "24/7 Clean Drinking Water",
    description: "Multi-stage reverse-osmosis filtration dispensers available on every residential floor.",
    icon: <Droplets className="w-5 h-5 text-emerald-400" />,
  },
  {
    title: "24/7 CCTV Security",
    tagline: "Continuous Campus Safety",
    description: "HD surveillance coverage across gates, entries, and common hallways for verified resident safety.",
    icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
  },
  {
    title: "In-House Laundry",
    tagline: "Effortless Daily Living",
    description: "Accessible laundry machines and clean drying areas to keep your wardrobe fresh with zero hassle.",
    icon: <Shirt className="w-5 h-5 text-emerald-400" />,
  },
];

export const EssentialFacilities: React.FC = () => {
  return (
    <section id="facilities" className="py-20 sm:py-28 bg-[#16221A] text-white relative overflow-hidden">
      {/* Background Lighting Accent */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-[#8E9F89]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-sm">
            <span>02 &bull; ESSENTIAL COMFORTS</span>
          </div>
          <h2 className="font-serif text-white text-3xl sm:text-4xl md:text-5xl font-normal tracking-tight leading-[1.1]">
            Engineered for Quiet Comfort, <br className="hidden sm:inline" />
            <span className="italic font-light text-white/95">Every Day</span>
          </h2>
          <p className="mt-3 text-white/70 text-sm sm:text-base font-light leading-relaxed">
            Four core essentials provided with every room format in Met City &amp; Yakubpur.
          </p>
        </div>

        {/* 4 Essential Facilities Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {essentialFacilities.map((fac, idx) => (
            <div
              key={idx}
              className="p-7 rounded-3xl bg-white/[0.04] border border-white/10 hover:border-white/25 transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between group"
            >
              <div>
                <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform">
                  {fac.icon}
                </div>
                <h3 className="font-serif text-xl sm:text-2xl font-normal text-white mb-1">
                  {fac.title}
                </h3>
                <p className="text-[11px] font-mono tracking-wider text-[#A8B9A1] uppercase mb-3">
                  {fac.tagline}
                </p>
                <p className="text-xs sm:text-sm text-white/70 font-light leading-relaxed">
                  {fac.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
