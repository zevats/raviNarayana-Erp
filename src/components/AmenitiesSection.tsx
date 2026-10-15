"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  Wifi,
  Droplets,
  ShieldCheck,
  UtensilsCrossed,
  Check,
} from "lucide-react";

interface FacilityItem {
  id: string;
  number: string;
  title: string;
  badge: string;
  icon: React.ReactNode;
  image: string;
  tagline: string;
  description: string;
  features: string[];
}

const facilities: FacilityItem[] = [
  {
    id: "wifi",
    number: "01",
    title: "High-Speed Wi-Fi",
    badge: "Connectivity",
    icon: <Wifi className="w-5 h-5 text-white" />,
    image: "/gallery/bedroom-deluxe.jpg",
    tagline: "Dedicated High-Bandwidth Wi-Fi",
    description:
      "Enterprise-grade fiber internet with uninterrupted coverage across all bedrooms and common areas. Ergonomic desks and uninterrupted power backup support study and remote work.",
    features: ["Fiber optic speed", "24/7 power backup", "Ergonomic study desk"],
  },
  {
    id: "water",
    number: "02",
    title: "Pure RO Water",
    badge: "Health & Hygiene",
    icon: <Droplets className="w-5 h-5 text-white" />,
    image: "/gallery/stairs.jpg",
    tagline: "Multi-Stage Purified Water",
    description:
      "Commercial multi-stage reverse-osmosis purification system with regular TDS testing and sanitized dispensers on every residential floor, ensuring clean drinking water around the clock.",
    features: ["Certified RO filtration", "Daily TDS monitoring", "Dispensers on all floors"],
  },
  {
    id: "security",
    number: "03",
    title: "24/7 CCTV Security",
    badge: "Safety & Peace",
    icon: <ShieldCheck className="w-5 h-5 text-white" />,
    image: "/gallery/room-2.jpg",
    tagline: "Continuous Campus Monitoring",
    description:
      "Gated residential complex with full high-definition surveillance coverage in hallways, entry gates, and common areas. Verified visitor protocols guarantee complete safety for all residents.",
    features: ["HD security cameras", "Gated entry control", "On-call resident warden"],
  },
  {
    id: "tiffin",
    number: "04",
    title: "Fresh Tiffin Service",
    badge: "Nutrition",
    icon: <UtensilsCrossed className="w-5 h-5 text-white" />,
    image: "/gallery/tiffin.png",
    tagline: "Home-Style Balanced Meals",
    description:
      "Wholesome North Indian vegetarian meals prepared daily with seasonal produce, pure spices, and low oil. Delivered warm for breakfast, lunch, and dinner directly to your room or workplace.",
    features: ["3 daily hot meals", "Seasonal fresh menu", "Hygienic kitchen prep"],
  },
];

import { SectionSeparator } from "./SectionSeparator";

export const AmenitiesSection: React.FC = () => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(0);
  const [activeMobileIndex, setActiveMobileIndex] = useState<number>(0);

  return (
    <section
      id="amenities"
      className="relative -mt-16 sm:-mt-24 z-20 text-white scroll-mt-20 overflow-x-clip"
    >
      {/* 
        Angled Background Surface:
        Clipped diagonally so the RoomsGallery section underneath shows cleanly above this line.
      */}
      <div
        className="absolute inset-0 bg-[#16221A] pointer-events-none"
        style={{ clipPath: "polygon(0 0, 100% 3.2vw, 100% 100%, 0 100%)" }}
      />

      {/* Background Subtle Ambiance */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#8E9F89]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-10 w-96 h-96 bg-black/40 rounded-full blur-3xl pointer-events-none" />

      {/* 
        Diagonal Ribbon Marquee:
        Centered exactly on the angled boundary, 100% unclipped.
      */}
      <div
        className="relative z-30 pointer-events-none select-none"
        style={{ marginTop: "calc(1.6vw - 20px)" }}
      >
        <SectionSeparator
          theme="forest"
          angle={1.8}
          direction="right"
          items={[
            { text: "CURATED LIVING FACILITIES", icon: "crest" },
            { text: "COMMERCIAL RO WATER PURIFICATION", icon: "water" },
            { text: "CONTINUOUS HD SURVEILLANCE", icon: "shield" },
            { text: "DEDICATED FIBER INTERNET", icon: "wifi" },
            { text: "BALANCED VEGETARIAN TIFFIN", icon: "dining" },
            { text: "DAILY SANITIZED COMMON AREAS", icon: "sparkles" },
            { text: "CORPORATE & SCHOLAR SUITES", icon: "pin" },
          ]}
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 pt-20 sm:pt-28 pb-24 sm:pb-32">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14 sm:mb-18">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/5 backdrop-blur-md text-[11px] font-sans tracking-[0.2em] text-white/90 uppercase mb-4 shadow-sm">
            <span>03 &bull; Curated Living Facilities</span>
          </div>

          <h2 className="font-serif text-white text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-normal tracking-tight leading-[1.08]">
            Engineered for Quiet Comfort, <br className="hidden sm:inline" />
            <span className="italic font-light text-white/95">Every Day</span>
          </h2>
          <p className="mt-4 text-white/75 text-sm sm:text-base md:text-lg leading-relaxed font-light">
            Essential comforts engineered into every accommodation tier to ensure a productive, safe, and restful stay in Met City &amp; Yakubpur.
          </p>
        </div>

        {/* Resorto 4-Facility Expanding Accordion (Desktop & Tablet) */}
        <div className="hidden md:flex flex-row h-[560px] lg:h-[620px] w-full rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-[#121A15]">
          {facilities.map((fac, idx) => {
            const isHovered = hoveredIndex === idx;

            return (
              <div
                key={fac.id}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className={`relative flex flex-col justify-end p-6 lg:p-8 cursor-pointer overflow-hidden transition-all duration-700 ease-out border-r border-white/10 last:border-r-0 ${
                  isHovered ? "flex-[2.6]" : hoveredIndex === null ? "flex-1" : "flex-[0.7]"
                }`}
                tabIndex={0}
                role="region"
                aria-label={fac.title}
              >
                {/* Background Image */}
                <div className="absolute inset-0 z-0">
                  <Image
                    src={fac.image}
                    alt={fac.title}
                    fill
                    sizes="(max-width: 1024px) 50vw, 25vw"
                    className={`object-cover object-center w-full h-full transition-transform duration-1000 ease-out ${
                      isHovered ? "scale-105" : "scale-100 opacity-60"
                    }`}
                  />
                  {/* Layered Gradient Overlays */}
                  <div
                    className={`absolute inset-0 transition-opacity duration-700 ${
                      isHovered
                        ? "bg-gradient-to-t from-[#16221A] via-[#16221A]/70 to-black/40"
                        : "bg-gradient-to-t from-[#16221A] via-[#16221A]/85 to-black/70"
                    }`}
                  />
                </div>

                {/* Stroked Background Number */}
                <div className="absolute top-6 right-6 z-10 pointer-events-none select-none">
                  <span
                    className={`text-6xl lg:text-8xl font-serif font-black transition-opacity duration-500 ${
                      isHovered ? "text-stroked-brass opacity-60" : "text-stroked-120 opacity-20"
                    }`}
                  >
                    {fac.number}
                  </span>
                </div>

                {/* Content Block */}
                <div className="relative z-10 flex flex-col justify-end">
                  {/* Badge & Icon Row */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 flex items-center justify-center shrink-0 shadow-sm">
                      {fac.icon}
                    </div>
                    <span className="text-[10px] uppercase font-mono tracking-wider px-2.5 py-1 rounded-full bg-white/10 border border-white/15 text-[#DCE5D7]">
                      {fac.badge}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="font-serif text-2xl lg:text-3xl font-medium text-white mb-1 tracking-tight">
                    {fac.title}
                  </h3>

                  <p className="text-xs uppercase font-mono text-[#A8B9A1] tracking-wider mb-2">
                    {fac.tagline}
                  </p>

                  {/* Service Divider */}
                  <div className="service-divider w-full h-0.5 bg-white/15 relative overflow-hidden my-3 rounded-full">
                    <div
                      className="service-complete-line h-full bg-white transition-all duration-700 ease-out"
                      style={{ width: isHovered ? "100%" : "25%" }}
                    />
                  </div>

                  {/* Reveal Description and Key Features */}
                  <div
                    className={`transition-all duration-700 ease-out overflow-hidden ${
                      isHovered
                        ? "max-h-56 opacity-100 translate-y-0 mt-1"
                        : "max-h-0 opacity-0 translate-y-3 pointer-events-none"
                    }`}
                  >
                    <p className="text-xs sm:text-sm text-white/80 leading-relaxed font-light mb-4 line-clamp-3">
                      {fac.description}
                    </p>

                    <div className="space-y-1.5 pt-2 border-t border-white/10">
                      {fac.features.map((item) => (
                        <div key={item} className="flex items-center gap-2 text-xs text-white/90">
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile Interactive Accordion (< md) */}
        <div className="md:hidden flex flex-col gap-4">
          {facilities.map((fac, idx) => {
            const isExpanded = activeMobileIndex === idx;

            return (
              <div
                key={fac.id}
                onClick={() => setActiveMobileIndex(isExpanded ? -1 : idx)}
                className="relative rounded-3xl overflow-hidden border border-white/10 bg-[#16221A] transition-all duration-500 shadow-xl"
              >
                {/* Background Image */}
                <div className="absolute inset-0 z-0">
                  <Image
                    src={fac.image}
                    alt={fac.title}
                    fill
                    sizes="100vw"
                    className={`object-cover object-center w-full h-full transition-transform duration-700 ${
                      isExpanded ? "scale-105" : "scale-100"
                    }`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#16221A] via-[#16221A]/85 to-black/60" />
                </div>

                <div className="relative z-10 p-5 sm:p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center">
                        {fac.icon}
                      </div>
                      <div>
                        <span className="text-[10px] font-mono text-[#DCE5D7] uppercase tracking-wider">
                          {fac.badge}
                        </span>
                        <h3 className="font-serif text-xl font-medium text-white">
                          {fac.title}
                        </h3>
                      </div>
                    </div>
                    <span className="text-3xl font-serif font-black text-stroked-brass">
                      {fac.number}
                    </span>
                  </div>

                  {/* Accordion Body */}
                  <div
                    className={`transition-all duration-500 overflow-hidden ${
                      isExpanded ? "max-h-64 opacity-100 pt-4 mt-3 border-t border-white/10" : "max-h-0 opacity-0"
                    }`}
                  >
                    <p className="text-xs text-[#A8B9A1] uppercase font-mono mb-2">
                      {fac.tagline}
                    </p>
                    <p className="text-xs sm:text-sm text-white/80 leading-relaxed font-light mb-3">
                      {fac.description}
                    </p>
                    <div className="space-y-1">
                      {fac.features.map((item) => (
                        <div key={item} className="flex items-center gap-2 text-xs text-white/90">
                          <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
